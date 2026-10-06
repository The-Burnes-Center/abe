/**
 * Structured JSON logger for the websocket-chat Lambda.
 *
 * Every line emitted is a JSON object readable by CloudWatch Logs Insights:
 *   { "level": "INFO", "message": "...", "function": "...", "correlation_id": "..." }
 *
 * Call setCorrelationId(sessionId) once at the start of each handler invocation
 * so every subsequent log line carries the session ID for cross-Lambda tracing.
 */

const FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME ?? "websocket-chat";

let _correlationId = "";

/** Bind a session ID (or any string) to all log lines for this invocation. */
export function setCorrelationId(id) {
  _correlationId = id ?? "";
}

function emit(level, message, extra = {}) {
  const entry = {
    level,
    message,
    function: FUNCTION_NAME,
    ...(_correlationId && { correlation_id: _correlationId }),
    ...extra,
  };
  console.log(JSON.stringify(entry));
}

export const logger = {
  info:  (msg, extra) => emit("INFO",  msg, extra),
  warn:  (msg, extra) => emit("WARN",  msg, extra),
  error: (msg, extra) => emit("ERROR", msg, extra),
};

/**
 * Emit a CloudWatch metric via Embedded Metric Format: Lambda turns this log
 * line into a metric with no extra API call, so an alarm can watch it.
 * Namespace defaults to "ABE/Chat" (override with METRICS_NAMESPACE).
 *
 * @param {string} name - Metric name, e.g. "SessionSaveFailures".
 * @param {number} [value=1]
 */
export function emitMetric(name, value = 1) {
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: process.env.METRICS_NAMESPACE || "ABE/Chat",
        Dimensions: [[]],
        Metrics: [{ Name: name, Unit: "Count" }],
      }],
    },
    [name]: value,
    function: FUNCTION_NAME,
    ...(_correlationId && { correlation_id: _correlationId }),
  }));
}
