import { describe, it, expect } from "vitest";
import {
  CHARTED_METRICS,
  METRIC_GROUPS,
  QUESTION_PREFIX,
  SUMMARY_PREFIX,
  aggregateGroupPct,
  failedQuestionCount,
  failedQuestionsLabel,
  groupScorePct,
  hasAnyScore,
  isFailedRow,
  normalizeServerTimestamp,
  presentMetrics,
  readMetric,
} from "./eval-metrics";

const [answer, retrieval, response] = METRIC_GROUPS;

const SEVEN_METRIC_SUMMARY = {
  average_similarity: 0.8,
  average_relevance: 0.7,
  average_correctness: 0.6,
  average_context_precision: 0.5,
  average_context_recall: 0.9,
  average_response_relevancy: 0.4,
  average_faithfulness: 1,
};

const { average_relevance: _dropped, ...sixMetricBase } = SEVEN_METRIC_SUMMARY;
const SIX_METRIC_SUMMARY = { ...sixMetricBase, average_relevance: null };

describe("readMetric", () => {
  it("treats null, undefined, NaN and junk as absent rather than 0", () => {
    expect(readMetric({ similarity: null }, "similarity")).toBeNull();
    expect(readMetric({}, "similarity")).toBeNull();
    expect(readMetric({ similarity: Number.NaN }, "similarity")).toBeNull();
    expect(readMetric({ similarity: "abc" }, "similarity")).toBeNull();
    expect(readMetric({ similarity: 0 }, "similarity")).toBe(0);
    expect(readMetric({ similarity: "0.25" }, "similarity")).toBe(0.25);
  });
});

describe("6 vs 7 metric payloads", () => {
  it("scores every group identically whether or not relevance is present", () => {
    for (const group of METRIC_GROUPS) {
      expect(groupScorePct(SIX_METRIC_SUMMARY, group, SUMMARY_PREFIX)).toBeCloseTo(
        groupScorePct(SEVEN_METRIC_SUMMARY, group, SUMMARY_PREFIX) as number
      );
    }
    expect(groupScorePct(SIX_METRIC_SUMMARY, answer, SUMMARY_PREFIX)).toBeCloseTo(70);
  });

  it("charts only metrics some row actually carries, never relevance", () => {
    expect(presentMetrics([SIX_METRIC_SUMMARY], CHARTED_METRICS, SUMMARY_PREFIX)).not.toContain("relevance");
    expect(presentMetrics([SEVEN_METRIC_SUMMARY], CHARTED_METRICS, SUMMARY_PREFIX)).toHaveLength(6);
  });

  it("averages a group over the metrics present instead of counting missing ones as 0", () => {
    expect(groupScorePct({ average_correctness: 0.6 }, answer, SUMMARY_PREFIX)).toBeCloseTo(60);
    expect(groupScorePct({ average_correctness: 0.6 }, retrieval, SUMMARY_PREFIX)).toBeNull();
  });

  it("recognizes a scored summary with or without relevance, and an unscored placeholder", () => {
    expect(hasAnyScore(SIX_METRIC_SUMMARY)).toBe(true);
    expect(hasAnyScore(SEVEN_METRIC_SUMMARY)).toBe(true);
    expect(hasAnyScore({ status: "RUNNING", average_relevance: null })).toBe(false);
  });
});

describe("failed questions", () => {
  const rows = [
    { correctness: 1, similarity: 1, faithfulness: 0.5 },
    { correctness: 0.5, similarity: 0.5 },
    { failed: true, error: "Model timed out" },
  ];

  it("excludes failed rows from aggregate scores", () => {
    expect(aggregateGroupPct(rows, answer, QUESTION_PREFIX)).toBeCloseTo(75);
    expect(aggregateGroupPct(rows, response, QUESTION_PREFIX)).toBeCloseTo(50);
    expect(aggregateGroupPct(rows, retrieval, QUESTION_PREFIX)).toBeNull();
  });

  it("does not let a failed row with stray scores skew the average", () => {
    const withStray = [...rows, { failed: true, correctness: 0, similarity: 0 }];
    expect(aggregateGroupPct(withStray, answer, QUESTION_PREFIX)).toBeCloseTo(75);
  });

  it("identifies failed rows and gives them no group score", () => {
    expect(isFailedRow(rows[2])).toBe(true);
    expect(isFailedRow(rows[0])).toBe(false);
    expect(groupScorePct(rows[2], answer, QUESTION_PREFIX)).toBeNull();
  });

  it("reads failed_questions defensively and labels it", () => {
    expect(failedQuestionCount({ failed_questions: 3 })).toBe(3);
    expect(failedQuestionCount({ failed_questions: null })).toBe(0);
    expect(failedQuestionCount({})).toBe(0);
    expect(failedQuestionsLabel(1)).toBe("1 question failed");
    expect(failedQuestionsLabel(3)).toBe("3 questions failed");
  });
});

describe("normalizeServerTimestamp", () => {
  it("reads naive Python timestamps as UTC and leaves zoned ones alone", () => {
    expect(normalizeServerTimestamp("2026-10-06 14:05:09.123456")).toBe("2026-10-06T14:05:09.123Z");
    expect(normalizeServerTimestamp("2026-10-06T14:05:09")).toBe("2026-10-06T14:05:09Z");
    expect(normalizeServerTimestamp("2026-10-06T14:05:09.000Z")).toBe("2026-10-06T14:05:09.000Z");
    expect(normalizeServerTimestamp("")).toBeNull();
    expect(normalizeServerTimestamp(undefined)).toBeNull();
  });
});
