/**
 * @module retry
 *
 * Transient-error classification and backoff for Bedrock calls, shared by
 * the chat handler and the evaluation Lambda.
 */

/** Retries per model call for transient Bedrock errors (throttles, 5xx, timeouts). */
export const MAX_STREAM_RETRIES = 3;

/** First retry waits up to this long; each further retry doubles it. */
const RETRY_BASE_DELAY_MS = 500;

/** Upper bound on a single retry wait. */
const RETRY_MAX_DELAY_MS = 8000;

const TRANSIENT_ERROR_NAMES = new Set([
  'ThrottlingException', 'ServiceUnavailableException',
  'InternalServerException', 'ModelNotReadyException', 'RequestTimeout',
  'ECONNRESET', 'ETIMEDOUT', 'NetworkingError',
]);

/**
 * True for Bedrock / network errors worth retrying (throttles, timeouts,
 * 5xx). Validation, auth and unknown errors are permanent.
 *
 * @param {Error & {__type?: string}} error
 * @returns {boolean}
 */
export function isTransientError(error) {
  if (!error) return false;
  const message = (error.message || "").toLowerCase();
  return TRANSIENT_ERROR_NAMES.has(error.name)
    || TRANSIENT_ERROR_NAMES.has(error.__type)
    || message.includes('timeout')
    || message.includes('throttl');
}

/**
 * Exponential backoff with full jitter: a random wait in
 * [0, min(max, base * 2^attempt)]. Jitter spreads retries from concurrent
 * chats so they don't hit a throttled model in lockstep. The base is
 * env-overridable (RETRY_BASE_DELAY_MS) so unit tests don't sleep.
 *
 * @param {number} attempt - 0-based retry number.
 * @returns {number} Milliseconds to wait.
 */
export function retryDelayMs(attempt) {
  const fromEnv = parseInt(process.env.RETRY_BASE_DELAY_MS ?? "", 10);
  const base = Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : RETRY_BASE_DELAY_MS;
  const ceiling = Math.min(RETRY_MAX_DELAY_MS, base * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
