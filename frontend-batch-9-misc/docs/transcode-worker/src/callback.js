import { signHmac } from "./hmac.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sendCallback(url, payload) {
  const body = JSON.stringify(payload);
  for (let attempt = 0; attempt <= config.callbackRetries; attempt++) {
    try {
      const ts = String(Date.now());
      const sig = signHmac({ secret: config.hmacSecret, timestamp: ts, body });
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": sig,
          "X-Timestamp": ts,
        },
        body,
      });
      if (res.ok) {
        logger.info({ job_id: payload.job_id, attempt }, "callback ok");
        return;
      }
      logger.warn({ status: res.status, attempt }, "callback non-2xx");
    } catch (err) {
      logger.warn({ err: err.message, attempt }, "callback error");
    }
    if (attempt < config.callbackRetries) {
      await sleep(config.callbackBackoffMs[attempt] ?? 60_000);
    }
  }
  logger.error({ job_id: payload.job_id }, "callback failed permanently");
}
