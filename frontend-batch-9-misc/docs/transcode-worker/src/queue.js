import PQueue from "p-queue";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { processJob } from "./transcode.js";
import { sendCallback } from "./callback.js";
import {
  queuePendingGauge,
  queueActiveGauge,
  jobsTotalGauge,
  jobsProcessedCounter,
  jobDurationHistogram,
  uploadedBytesCounter,
} from "./metrics.js";

const queue = new PQueue({ concurrency: config.concurrency });
const jobs = new Map(); // job_id -> { status, error, output }

function refreshGauges() {
  queuePendingGauge.set(queue.size);
  queueActiveGauge.set(queue.pending);
  jobsTotalGauge.set(jobs.size);
}

queue.on("add", refreshGauges);
queue.on("active", refreshGauges);
queue.on("next", refreshGauges);
queue.on("idle", refreshGauges);

export function queueStats() {
  return { pending: queue.size, active: queue.pending, total: jobs.size };
}

export function getJob(id) {
  return jobs.get(id);
}

export function enqueue(job) {
  jobs.set(job.job_id, { status: "queued" });
  refreshGauges();
  queue.add(async () => {
    jobs.set(job.job_id, { status: "processing" });
    refreshGauges();
    const startedAt = Date.now();
    try {
      const result = await processJob(job);
      const elapsed = (Date.now() - startedAt) / 1000;
      jobs.set(job.job_id, { status: "done", output: result });
      jobsProcessedCounter.inc({ status: "done" });
      jobDurationHistogram.observe({ status: "done" }, elapsed);
      if (result?.size_bytes) uploadedBytesCounter.inc(result.size_bytes);
      await sendCallback(job.callback_url, {
        job_id: job.job_id,
        status: "done",
        ...result,
      });
    } catch (err) {
      const elapsed = (Date.now() - startedAt) / 1000;
      logger.error({ err: err.message, job_id: job.job_id }, "job failed");
      jobs.set(job.job_id, { status: "failed", error: err.message });
      jobsProcessedCounter.inc({ status: "failed" });
      jobDurationHistogram.observe({ status: "failed" }, elapsed);
      await sendCallback(job.callback_url, {
        job_id: job.job_id,
        status: "failed",
        error: String(err.message ?? err),
      });
    } finally {
      refreshGauges();
    }
  });
}
