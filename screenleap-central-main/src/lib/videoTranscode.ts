/**
 * Video transcode detection using MediaInfo.js (WASM).
 * Determines whether a video file needs server-side transcoding before it can
 * be used in schedules.
 *
 * Thresholds (from docs/transcode-spec.md):
 *   FPS > 60 | bitrate > 20 Mbps | codec ≠ h264/avc | container ≠ mp4 | > 4K
 */

export interface VideoSourceMeta {
  fps: number;
  bitrate: number;       // bps
  codec: string;         // e.g. "avc", "hevc"
  container: string;     // file extension without dot, e.g. "mp4"
  width: number;
  height: number;
  needsTranscode: boolean;
}

const FPS_LIMIT = 60;
const BITRATE_LIMIT = 20_000_000;
const MAX_WIDTH = 3840;
const MAX_HEIGHT = 2160;

function checkNeedsTranscode(m: Omit<VideoSourceMeta, "needsTranscode">): boolean {
  return (
    m.fps > FPS_LIMIT ||
    m.bitrate > BITRATE_LIMIT ||
    !["h264", "avc"].includes(m.codec.toLowerCase()) ||
    m.container.toLowerCase() !== "mp4" ||
    m.width > MAX_WIDTH ||
    m.height > MAX_HEIGHT
  );
}

/**
 * Probe a video File with MediaInfo.js (WASM at /mediainfo/MediaInfoModule.wasm).
 * Falls back to basic browser-native detection if WASM fails to load.
 */
export async function probeVideoMeta(file: File): Promise<VideoSourceMeta> {
  const container = file.name.split(".").pop()?.toLowerCase() ?? "";

  try {
    // Dynamic import so the large WASM is only loaded when needed.
    const MediaInfoFactory = (await import("mediainfo.js")).default;
    const mi = await MediaInfoFactory({
      format: "object",
      locateFile: () => "/mediainfo/MediaInfoModule.wasm",
    });

    let result: any;
    try {
      result = await mi.analyzeData(
        () => file.size,
        (size: number, offset: number) =>
          file.slice(offset, offset + size).arrayBuffer().then((b) => new Uint8Array(b)),
      );
    } finally {
      mi.close();
    }

    const videoTrack = result?.media?.track?.find((t: any) => t["@type"] === "Video");
    const generalTrack = result?.media?.track?.find((t: any) => t["@type"] === "General");

    const fps = Number(videoTrack?.FrameRate ?? 0);
    const bitrate = Number(videoTrack?.BitRate ?? generalTrack?.OverallBitRate ?? 0);
    const codec = String(videoTrack?.Format ?? "").toLowerCase();
    const width = Number(videoTrack?.Width ?? 0);
    const height = Number(videoTrack?.Height ?? 0);

    const meta = { fps, bitrate, codec, container, width, height };
    return { ...meta, needsTranscode: checkNeedsTranscode(meta) };
  } catch {
    // WASM failed — fall back to container check only
    const meta = { fps: 0, bitrate: 0, codec: "unknown", container, width: 0, height: 0 };
    return { ...meta, needsTranscode: checkNeedsTranscode(meta) };
  }
}
