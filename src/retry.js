import { wait } from './utils.js';

function parseRetryAfterSeconds(message) {
  if (!message) return null;
  const m = String(message).match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (!m) return null;
  const seconds = Number(m[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

function looksLikeHardQuota(message) {
  const txt = String(message || '').toLowerCase();
  // Avoid retry loops when the project has 0 quota for a metric/model.
  return txt.includes('limit: 0') || txt.includes('quota exceeded for metric');
}

export async function withExponentialBackoff(fn, opts = {}) {
  const {
    maxRetries = 4,
    baseDelayMs = 800,
    maxDelayMs = 8000,
    jitter = true,
    shouldRetry = (e) => (e?.status === 429),
    onRetry = () => {},
  } = opts;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt += 1;
      if (attempt > maxRetries || !shouldRetry(e)) throw e;

      const msg = e?.message || e?.error?.message || '';
      if (looksLikeHardQuota(msg)) throw e;

      const retryAfterSec = parseRetryAfterSeconds(msg);
      let delayMs = retryAfterSec != null
        ? Math.ceil(retryAfterSec * 1000)
        : Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));

      if (jitter) {
        const rand = 0.85 + Math.random() * 0.3; // 0.85..1.15
        delayMs = Math.round(delayMs * rand);
      }

      onRetry({ attempt, delayMs, error: e });
      await wait(delayMs);
    }
  }
}

