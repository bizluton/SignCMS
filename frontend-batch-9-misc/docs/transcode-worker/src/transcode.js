import { spawn } from "node:child_process";
import { mkdir, stat, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { uploadFile } from "./s3.js";
import { ffmpegDurationHistogram, uploadDurationHistogram } from "./metrics.js";
import { sendCallback } from "./callback.js";

// 預設轉檔目標，可由 job.target 覆寫
const DEFAULTS = {
  container: "mp4",
  video_codec: "h264",
  max_height: 1080,
  fps: 30,
  video_bitrate: 8_000_000,
  pix_fmt: "yuv420p",
  audio_codec: "aac",
  audio_bitrate: 128_000,
};

const PROGRESS_INTERVAL_MS = 5_000;

async function downloadTo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download_failed_${res.status}`);
  await pipeline(res.body, createWriteStream(destPath));
}

/**
 * 跑 ffmpeg 並解析 -progress 輸出 (key=value 一行一個)。
 * onProgress({ progressRatio: 0..1, outTimeSec, speed })，由 caller 自行 throttle。
 */
function runFfmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.ffmpegBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let progressBuf = "";

    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      // 限制 stderr 累積避免吃光記憶體
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });

    // -progress pipe:1 會把 key=value 寫到 stdout
    proc.stdout.on("data", (d) => {
      progressBuf += d.toString();
      let idx;
      const fields = {};
      while ((idx = progressBuf.indexOf("\n")) !== -1) {
        const line = progressBuf.slice(0, idx).trim();
        progressBuf = progressBuf.slice(idx + 1);
        if (!line) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const k = line.slice(0, eq).trim();
        const v = line.slice(eq + 1).trim();
        fields[k] = v;
        if (k === "progress") {
          // 一個 progress block 結束，回報一次
          const outTimeUs = Number(fields.out_time_us ?? fields.out_time_ms ?? 0);
          const outTimeSec = outTimeUs / 1_000_000;
          const speed = Number((fields.speed ?? "0x").replace("x", "")) || 0;
          try {
            onProgress?.({ outTimeSec, speed, ended: v === "end" });
          } catch (e) {
            // 進度回報錯誤不影響轉檔本身
          }
          // 清空 fields 給下一個 block (僅清非累積 key)
          for (const key of Object.keys(fields)) delete fields[key];
        }
      }
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg_exit_${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function probe(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:format=duration",
      "-of", "json",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error("ffprobe_failed"));
      try {
        const j = JSON.parse(out);
        resolve({
          width: Number(j.streams?.[0]?.width ?? 0),
          height: Number(j.streams?.[0]?.height ?? 0),
          duration: Number(j.format?.duration ?? 0),
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

export async function processJob(job) {
  const target = { ...DEFAULTS, ...(job.target ?? {}) };
  const workDir = path.join(config.tmpDir, job.job_id);
  await mkdir(workDir, { recursive: true });
  const inputPath = path.join(workDir, "input");
  const outputName = `${job.job_id}.${target.container}`;
  const outputPath = path.join(config.tmpDir, outputName);

  logger.info({ job_id: job.job_id }, "downloading input");
  await downloadTo(job.input_url, inputPath);

  // 先 probe 取得來源總長度，作為進度百分比的分母
  const sourceInfo = await probe(inputPath).catch(() => ({ duration: 0, width: 0, height: 0 }));
  const sourceDuration = sourceInfo.duration || 0;

  const vfScale = `scale='min(-2,iw)':'min(${target.max_height},ih)':force_original_aspect_ratio=decrease`;
  const vf = `${vfScale},fps=${target.fps},format=${target.pix_fmt}`;

  const args = [
    "-y",
    "-nostats",
    "-i", inputPath,
    "-c:v", "libx264",
    "-profile:v", "high",
    "-preset", "medium",
    "-vf", vf,
    "-b:v", String(target.video_bitrate),
    "-maxrate", String(target.video_bitrate),
    "-bufsize", String(target.video_bitrate * 2),
    "-c:a", target.audio_codec,
    "-b:a", String(target.audio_bitrate),
    "-ar", "48000",
    "-ac", "2",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    outputPath,
  ];

  logger.info({ job_id: job.job_id, args, sourceDuration }, "ffmpeg start");
  const ffmpegStart = Date.now();

  // 進度回報節流：每 PROGRESS_INTERVAL_MS 才 fire-and-forget 一次 callback
  let lastReportAt = 0;
  let lastProgress = -1;
  const fireProgress = (progress, extra) => {
    // 不 await，避免拖慢 ffmpeg 處理
    sendCallback(job.callback_url, {
      job_id: job.job_id,
      status: "progress",
      progress, // 0..100 (整數)
      ...extra,
    }).catch(() => {});
  };

  await runFfmpeg(args, ({ outTimeSec, speed, ended }) => {
    const now = Date.now();
    let progress = 0;
    if (sourceDuration > 0) {
      progress = Math.min(99, Math.max(0, Math.round((outTimeSec / sourceDuration) * 100)));
    }
    if (ended) return; // 完成由外層送 done callback
    if (progress === lastProgress) return;
    if (now - lastReportAt < PROGRESS_INTERVAL_MS) return;
    lastReportAt = now;
    lastProgress = progress;
    fireProgress(progress, {
      out_time_seconds: Math.round(outTimeSec),
      source_duration_seconds: Math.round(sourceDuration),
      speed,
    });
  });

  ffmpegDurationHistogram.observe((Date.now() - ffmpegStart) / 1000);

  const [info, st] = await Promise.all([probe(outputPath), stat(outputPath)]);
  await unlink(inputPath).catch(() => {});

  // 上傳到 S3 / R2 / MinIO
  const s3Key = `${config.s3KeyPrefix}${outputName}`;
  logger.info({ job_id: job.job_id, s3Key, size: st.size }, "uploading to s3");
  // 上傳階段也回報一次（99%），讓 UI 不會卡在 ffmpeg 完成的百分比
  fireProgress(99, { phase: "uploading" });

  const uploadStart = Date.now();
  const output_url = await uploadFile({
    filePath: outputPath,
    key: s3Key,
    contentType: target.container === "mp4" ? "video/mp4" : "application/octet-stream",
  });
  uploadDurationHistogram.observe((Date.now() - uploadStart) / 1000);
  logger.info({ job_id: job.job_id, output_url }, "upload done");

  if (config.deleteAfterUpload) {
    await unlink(outputPath).catch(() => {});
  }

  return {
    output_url,
    duration_seconds: Math.round(info.duration),
    size_bytes: st.size,
    width: info.width,
    height: info.height,
    storage_key: s3Key,
  };
}
