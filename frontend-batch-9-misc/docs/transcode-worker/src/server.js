// SignCMS 轉檔 Worker — 入口
// 接 POST /jobs (HMAC) → 加入佇列 → ffmpeg 處理 → 回呼 CMS
import express from "express";
import pinoHttp from "pino-http";
import { logger } from "./logger.js";
import { verifyHmac } from "./hmac.js";
import { enqueue, getJob, queueStats } from "./queue.js";
import { config } from "./config.js";
import { register } from "./metrics.js";

const app = express();

// 保留 raw body 給 HMAC 驗章用（驗章必須用未經 JSON.parse 的原文）
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
);
app.use(pinoHttp({ logger }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ...queueStats() });
});

// Prometheus 抓取端點 — 直接 scrape http://worker:8080/metrics
app.get("/metrics", async (_req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(String(err));
  }
});

app.post("/jobs", (req, res) => {
  const sig = req.header("X-Signature");
  const ts = req.header("X-Timestamp");
  if (!sig || !ts) return res.status(401).json({ error: "missing_signature" });

  try {
    verifyHmac({ secret: config.hmacSecret, timestamp: ts, body: req.rawBody, signature: sig });
  } catch (err) {
    req.log.warn({ err: err.message }, "HMAC verify failed");
    return res.status(401).json({ error: "invalid_signature" });
  }

  const { job_id, input_url, callback_url, target } = req.body ?? {};
  if (!job_id || !input_url || !callback_url) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const existing = getJob(job_id);
  if (existing) {
    return res.status(202).json({ job_id, status: existing.status, deduplicated: true });
  }

  enqueue({ job_id, input_url, callback_url, target: target ?? {} });
  res.status(202).json({ job_id, status: "queued" });
});

app.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not_found" });
  res.json(job);
});

app.use((err, req, res, _next) => {
  req.log.error({ err }, "unhandled");
  res.status(500).json({ error: "internal" });
});

app.listen(config.port, () => {
  logger.info(
    { port: config.port, concurrency: config.concurrency, tmpDir: config.tmpDir },
    "transcode worker listening",
  );
});
