/**
 * Evaluation metric helpers shared by the Quality Monitoring pages.
 *
 * Payloads may carry any subset of the RAGAS metrics (older runs lack the
 * RAG metrics; newer runs may drop `relevance`). Everything here treats a
 * missing or non-numeric metric as absent rather than 0, so the UI only
 * renders what the backend actually scored.
 */

/** Per-question metric fields on EvaluationResultsTable items. */
export const METRIC_KEYS = [
  "similarity",
  "relevance",
  "correctness",
  "context_precision",
  "context_recall",
  "response_relevancy",
  "faithfulness",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

/** Summary rows prefix every metric with `average_`; per-question rows don't. */
export type MetricPrefix = "" | "average_";

export const SUMMARY_PREFIX: MetricPrefix = "average_";
export const QUESTION_PREFIX: MetricPrefix = "";

export const METRIC_LABELS: Record<MetricKey, string> = {
  similarity: "Similarity",
  relevance: "Relevance",
  correctness: "Correctness",
  context_precision: "Context Precision",
  context_recall: "Context Recall",
  response_relevancy: "Relevancy",
  faithfulness: "Faithfulness",
};

export const METRIC_DESCRIPTIONS = {
  answerQuality: {
    short: "Are the chatbot's answers correct? High = answers match your expected responses. Low = answers differ: this could mean the chatbot is wrong, or your test Q&A may be outdated if documents have changed.",
    detail: "Compares the chatbot's answers against the expected responses in your test file. High scores mean strong alignment. Low scores could mean the chatbot is giving wrong answers, but also check whether your expected responses are still accurate. If your source documents have been updated, the \"correct\" answers in your test file may be outdated and need refreshing.",
  },
  retrievalQuality: {
    short: "Is the chatbot finding the right documents? High = relevant sources retrieved. Low = wrong or missing documents (consider if new documents were added or old ones removed).",
    detail: "Measures how well the chatbot searches your knowledge base. High scores mean it pulls the right documents for each question. Low scores could mean your documents are missing content on certain topics, are poorly structured, or were recently reorganized. If you've added or changed documents, re-run the evaluation to see if retrieval improves.",
  },
  responseQuality: {
    short: "Is the response trustworthy? High = on-topic, evidence-based answers. Low = off-topic or unsupported claims, especially important to monitor after document changes.",
    detail: "Measures whether the chatbot stays on-topic and only says things supported by your documents. High scores mean reliable responses. Low scores mean the chatbot may be going off-topic or making claims not found in any document. After updating documents, this metric helps verify the chatbot hasn't started hallucinating on topics where content changed.",
  },
  correctness: "High = the chatbot's facts align with your expected answer. Low = facts differ: the chatbot may be wrong, or your expected answer may need updating if the source documents have changed since the test file was created.",
  similarity: "High = the chatbot's answer conveys the same meaning as expected. Low = the meaning has diverged. Compare the actual vs. expected columns to determine if the chatbot is off or if the expected response needs refreshing.",
  relevance: "High = the answer is relevant to the question asked. Low = the answer drifts from what was asked.",
  contextPrecision: "High = the retrieved documents are relevant to the question. Low = irrelevant documents are being pulled. Check if your documents are clearly titled and well-organized, or if recently added documents are causing noise.",
  contextRecall: "High = the retrieved documents contain enough info to fully answer the question. Low = key information is missing from retrieved results. You may need to add source documents covering these topics, or the existing documents may have been modified.",
  responseRelevancy: "High = the answer directly addresses the question. Low = the response goes off-topic or includes unrelated information. This can happen when retrieved documents cover similar but not identical topics.",
  faithfulness: "High = every claim in the answer is supported by a retrieved document. Low = the chatbot is generating information not found in your documents. This is the most critical trust metric: low scores here mean users could receive made-up information.",
};

export const METRIC_TOOLTIPS: Record<MetricKey, string> = {
  similarity: METRIC_DESCRIPTIONS.similarity,
  relevance: METRIC_DESCRIPTIONS.relevance,
  correctness: METRIC_DESCRIPTIONS.correctness,
  context_precision: METRIC_DESCRIPTIONS.contextPrecision,
  context_recall: METRIC_DESCRIPTIONS.contextRecall,
  response_relevancy: METRIC_DESCRIPTIONS.responseRelevancy,
  faithfulness: METRIC_DESCRIPTIONS.faithfulness,
};

export type MetricGroupId = "answerQuality" | "retrievalQuality" | "responseQuality";

export interface MetricGroup {
  id: MetricGroupId;
  label: string;
  metrics: readonly MetricKey[];
}

/** The three headline scores, each the mean of the metrics it groups. */
export const METRIC_GROUPS: readonly MetricGroup[] = [
  { id: "answerQuality", label: "Answer Quality", metrics: ["correctness", "similarity"] },
  { id: "retrievalQuality", label: "Retrieval Quality", metrics: ["context_precision", "context_recall"] },
  { id: "responseQuality", label: "Response Quality", metrics: ["response_relevancy", "faithfulness"] },
];

/**
 * Metrics charted individually on the dashboard, in display order. `relevance`
 * is left out: it duplicates response_relevancy and newer runs omit it.
 */
export const CHARTED_METRICS: readonly MetricKey[] = [
  "correctness",
  "similarity",
  "context_precision",
  "context_recall",
  "response_relevancy",
  "faithfulness",
];

export type MetricRecord = Record<string, unknown>;

/** A finite numeric metric value, or null if absent/unparseable. */
export function readMetric(
  item: MetricRecord | null | undefined,
  key: MetricKey,
  prefix: MetricPrefix = QUESTION_PREFIX,
): number | null {
  const raw = item?.[`${prefix}${key}`];
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Mean of the values that are present; null when none are. */
export function meanOfPresent(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (present.length === 0) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

/** Convert a 0-1 score to a percentage, preserving null. */
export function toPct(value: number | null): number | null {
  return value === null ? null : value * 100;
}

/** Group score (0-100) for one row, averaging only the metrics it has. */
export function groupScorePct(
  item: MetricRecord | null | undefined,
  group: MetricGroup,
  prefix: MetricPrefix = QUESTION_PREFIX,
): number | null {
  return toPct(meanOfPresent(group.metrics.map((key) => readMetric(item, key, prefix))));
}

/** Mean of one metric across rows (0-1), skipping rows that lack it. */
export function averageMetric(
  items: readonly MetricRecord[],
  key: MetricKey,
  prefix: MetricPrefix = QUESTION_PREFIX,
): number | null {
  return meanOfPresent(items.map((item) => readMetric(item, key, prefix)));
}

/**
 * Group score (0-100) across many rows: each metric is averaged over the
 * scored rows that have it, then the group averages whichever metrics exist.
 * Failed question rows are excluded.
 */
export function aggregateGroupPct(
  items: readonly MetricRecord[],
  group: MetricGroup,
  prefix: MetricPrefix = QUESTION_PREFIX,
): number | null {
  const scored = items.filter((item) => !isFailedRow(item));
  return toPct(meanOfPresent(group.metrics.map((key) => averageMetric(scored, key, prefix))));
}

/** A per-question result the pipeline could not score (`failed: true`). */
export function isFailedRow(item: MetricRecord | null | undefined): boolean {
  return item?.failed === true;
}

/** The failure reason on a failed question row, if the backend sent one. */
export function failureReason(item: MetricRecord | null | undefined): string {
  const error = item?.error;
  return typeof error === "string" ? error : "";
}

/** `failed_questions` on a summary row, or 0 when absent/invalid. */
export function failedQuestionCount(item: MetricRecord | null | undefined): number {
  const raw = item?.failed_questions;
  const count = typeof raw === "string" ? Number(raw) : raw;
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** "1 question failed" / "3 questions failed". */
export function failedQuestionsLabel(count: number): string {
  return `${count} question${count === 1 ? "" : "s"} failed`;
}

/** Metrics from `candidates` that at least one row actually carries. */
export function presentMetrics(
  items: readonly MetricRecord[],
  candidates: readonly MetricKey[] = METRIC_KEYS,
  prefix: MetricPrefix = QUESTION_PREFIX,
): MetricKey[] {
  return candidates.filter((key) => items.some((item) => readMetric(item, key, prefix) !== null));
}

/** True when a summary row has any scored metric (i.e. the run produced results). */
export function hasAnyScore(item: MetricRecord | null | undefined, prefix: MetricPrefix = SUMMARY_PREFIX): boolean {
  return METRIC_KEYS.some((key) => {
    const value = readMetric(item, key, prefix);
    return value !== null && value > 0;
  });
}

/** Format a percentage for display; absent values render as "n/a". */
export function formatPct(pct: number | null): string {
  return pct === null ? "n/a" : `${pct.toFixed(0)}%`;
}

export type ScoreColor = "success" | "warning" | "error";

const GOOD_THRESHOLD = 75;
const FAIR_THRESHOLD = 50;

export function scoreColor(pct: number): ScoreColor {
  if (pct >= GOOD_THRESHOLD) return "success";
  if (pct >= FAIR_THRESHOLD) return "warning";
  return "error";
}

export function scoreBgKey(pct: number): string {
  return `${scoreColor(pct)}.light`;
}

export function scoreBand<T>(pct: number, good: T, fair: T, poor: T): T {
  if (pct >= GOOD_THRESHOLD) return good;
  if (pct >= FAIR_THRESHOLD) return fair;
  return poor;
}

const NAIVE_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?$/;

/**
 * Normalize a server timestamp to an ISO string with a zone. The eval
 * pipeline writes Python `str(datetime.now())` from Lambda (UTC, but with no
 * zone suffix), which browsers would otherwise read as local time. Strings
 * that already carry a zone pass through unchanged; empty input returns null.
 */
export function normalizeServerTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const match = NAIVE_TIMESTAMP.exec(value.trim());
  if (!match) return value;
  const millis = match[3] ? match[3].slice(0, 4).padEnd(4, "0") : "";
  return `${match[1]}T${match[2]}${millis}Z`;
}

/** Epoch millis for a server timestamp, or NaN when it can't be parsed. */
export function serverTimestampMs(value: unknown): number {
  const iso = normalizeServerTimestamp(value);
  return iso === null ? NaN : new Date(iso).getTime();
}
