// Prometheus metrics — 用標準 prom-client 暴露 /metrics
// 監控項目：佇列長度、處理中數量、累計成功/失敗、處理時間直方圖、上傳位元組數
import client from "prom-client";

export const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: "transcode_worker_" });

// Gauges — 即時狀態
export const queuePendingGauge = new client.Gauge({
  name: "transcode_queue_pending",
  help: "Number of jobs waiting in the queue",
  registers: [register],
});

export const queueActiveGauge = new client.Gauge({
  name: "transcode_queue_active",
  help: "Number of jobs currently being processed",
  registers: [register],
});

export const jobsTotalGauge = new client.Gauge({
  name: "transcode_jobs_tracked_total",
  help: "Total number of jobs currently tracked in memory",
  registers: [register],
});

// Counters — 累計事件
export const jobsProcessedCounter = new client.Counter({
  name: "transcode_jobs_processed_total",
  help: "Total number of jobs that finished",
  labelNames: ["status"], // "done" | "failed"
  registers: [register],
});

export const uploadedBytesCounter = new client.Counter({
  name: "transcode_uploaded_bytes_total",
  help: "Total bytes uploaded to object storage",
  registers: [register],
});

// Histograms — 處理時間分佈（秒）
export const jobDurationHistogram = new client.Histogram({
  name: "transcode_job_duration_seconds",
  help: "End-to-end job duration in seconds (download + ffmpeg + upload)",
  labelNames: ["status"],
  buckets: [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600],
  registers: [register],
});

export const ffmpegDurationHistogram = new client.Histogram({
  name: "transcode_ffmpeg_duration_seconds",
  help: "ffmpeg execution time in seconds",
  buckets: [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600],
  registers: [register],
});

export const uploadDurationHistogram = new client.Histogram({
  name: "transcode_upload_duration_seconds",
  help: "S3/R2 upload time in seconds",
  buckets: [1, 5, 15, 30, 60, 120, 300, 600],
  registers: [register],
});
