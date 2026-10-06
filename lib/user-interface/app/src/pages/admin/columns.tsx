import { ReactNode } from "react";
import { AdminDataType } from "../../common/types";
import { Utils } from "../../common/utils";
import { Button, Tooltip, Chip, IconButton, Skeleton, Typography } from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { TruncatedTextCell } from "../../components/truncated-text-call";
import {
  FailedScore,
  GroupScoreChip,
  HeaderWithInfo,
  MetricHints,
  ViewDetailsButton,
} from "./column-cells";
import {
  METRIC_DESCRIPTIONS,
  METRIC_GROUPS,
  MetricGroupId,
  MetricKey,
  MetricPrefix,
  QUESTION_PREFIX,
  SUMMARY_PREFIX,
  failedQuestionCount,
  failureReason,
  isFailedRow,
  normalizeServerTimestamp,
  readMetric,
  serverTimestampMs,
} from "./eval-metrics";

/** A table row as returned by the admin APIs: loosely typed JSON. */
export type ColumnItem = Record<string, unknown>;

export interface ColumnDefinition {
  id: string;
  header: ReactNode;
  cell: (item: ColumnItem) => ReactNode;
  sortingField?: string;
  sortingComparator?: (a: ColumnItem, b: ColumnItem) => number;
  width?: string;
  disableSort?: boolean;
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value || fallback;
  if (typeof value === "number") return String(value);
  return fallback;
}

function group(id: MetricGroupId) {
  const found = METRIC_GROUPS.find((g) => g.id === id);
  if (!found) throw new Error(`Unknown metric group: ${id}`);
  return found;
}

/** Date/time in the deployment's time zone. */
function formatDate(value: unknown): string {
  return Utils.formatTimestamp(normalizeServerTimestamp(value));
}

/** Sort by a numeric metric, putting rows that lack it first. */
const metricSort =
  (field: MetricKey, prefix: MetricPrefix) => (a: ColumnItem, b: ColumnItem) =>
    (readMetric(a, field, prefix) ?? -1) - (readMetric(b, field, prefix) ?? -1);

const SUMMARY_HINTS: MetricHints = {
  correctness: [
    "Answers align with expected responses",
    "Some answers differ from expected. Check if test Q&A is still current",
    "Significant gaps: either the chatbot or your test expected answers may need updating",
  ],
  similarity: [
    "Meaning closely matches expected",
    "Partial match. Compare actual vs. expected to see what diverged",
    "Answers convey different meaning. Review if documents or test data changed",
  ],
  context_precision: [
    "Retrieved documents are relevant",
    "Some unrelated documents pulled. Check document titles and structure",
    "Mostly irrelevant documents. Reorganize or re-title source content",
  ],
  context_recall: [
    "Key information is being found",
    "Some info missing. Check if documents were recently changed or removed",
    "Critical content not found. Add or restore source documents on these topics",
  ],
  response_relevancy: [
    "Answers directly address the question",
    "Some answers stray off-topic",
    "Answers frequently miss the point. Review these questions individually",
  ],
  faithfulness: [
    "Answers are grounded in source documents",
    "Some claims lack document support. Verify after document changes",
    "Hallucination risk: chatbot is generating unsupported claims",
  ],
};

const DETAIL_HINTS: MetricHints = {
  correctness: [
    "Chatbot's facts match expected answer",
    "Some facts differ. Compare Expected vs. Actual columns",
    "Major differences. Check if expected answer is still accurate",
  ],
  similarity: [
    "Meaning closely aligns",
    "Partial match: wording or scope may differ",
    "Very different meaning. Expected answer may need updating",
  ],
  context_precision: [
    "Relevant docs retrieved",
    "Some unrelated docs pulled",
    "Wrong documents retrieved. Topic may lack clear source content",
  ],
  context_recall: [
    "All needed info found",
    "Partial info: some source content may be missing",
    "Key content not found. Check if documents were changed or removed",
  ],
  response_relevancy: [
    "Directly answers the question",
    "Partially on-topic, may include tangential info",
    "Off-topic: chatbot may be confused by similar documents",
  ],
  faithfulness: [
    "Claims supported by source documents",
    "Some claims lack document support",
    "Unsupported claims present. Verify source documents exist for this topic",
  ],
};

// Renders the SyncStatus value the backend stamps on each document. All
// determination logic lives in the get-s3 Lambda (ListKnowledgeBaseDocuments
// + status mapping); the UI just picks a label and color.
const SYNC_STATUS_CHIPS: Record<
  string,
  { label: string; color: "success" | "info" | "error" | "default"; tip: string }
> = {
  synced: {
    label: "Synced",
    color: "success",
    tip: "Indexed in the knowledge base and available to the chatbot.",
  },
  syncing: {
    label: "Syncing",
    color: "info",
    tip: "Currently being ingested by Bedrock. Refresh to see status updates.",
  },
  failed: {
    label: "Failed",
    color: "error",
    tip: "Bedrock could not ingest this file. Try syncing again; if it keeps failing, the file may need to be re-uploaded.",
  },
  not_yet_synced: {
    label: "Not synced",
    color: "default",
    tip: "Uploaded but not yet indexed, so the chatbot can't use it yet. Click “Sync data now” to add it to the knowledge base.",
  },
};

export function getColumnDefinition(
  documentType: AdminDataType,
  onProblemClick: (item: ColumnItem) => void,
  options?: { onDeleteEvaluation?: (item: ColumnItem) => void; syncStatusLoading?: boolean }
): ColumnDefinition[] {
  const EVAL_SUMMARY_COLUMN_DEFINITIONS: ColumnDefinition[] = [
    {
      id: "evaluationName",
      header: "Name",
      cell: (item) => (
        <TruncatedTextCell text={text(item.evaluation_name, "Unnamed")} maxLength={40} />
      ),
    },
    {
      id: "timestamp",
      header: "Date",
      cell: (item) => formatDate(item.Timestamp),
      sortingField: "Timestamp",
      sortingComparator: (a, b) =>
        (serverTimestampMs(a.Timestamp) || 0) - (serverTimestampMs(b.Timestamp) || 0),
    },
    {
      id: "answerQuality",
      header: <HeaderWithInfo label="Answer Quality" tooltip={METRIC_DESCRIPTIONS.answerQuality.short} />,
      cell: (item) => (
        <GroupScoreChip item={item} group={group("answerQuality")} prefix={SUMMARY_PREFIX} hints={SUMMARY_HINTS} bold />
      ),
      sortingField: "average_correctness",
      sortingComparator: metricSort("correctness", SUMMARY_PREFIX),
    },
    {
      id: "retrievalQuality",
      header: <HeaderWithInfo label="Retrieval Quality" tooltip={METRIC_DESCRIPTIONS.retrievalQuality.short} />,
      cell: (item) => (
        <GroupScoreChip item={item} group={group("retrievalQuality")} prefix={SUMMARY_PREFIX} hints={SUMMARY_HINTS} bold />
      ),
      sortingField: "average_context_precision",
      sortingComparator: metricSort("context_precision", SUMMARY_PREFIX),
    },
    {
      id: "responseQuality",
      header: <HeaderWithInfo label="Response Quality" tooltip={METRIC_DESCRIPTIONS.responseQuality.short} />,
      cell: (item) => (
        <GroupScoreChip item={item} group={group("responseQuality")} prefix={SUMMARY_PREFIX} hints={SUMMARY_HINTS} bold />
      ),
      sortingField: "average_faithfulness",
      sortingComparator: metricSort("faithfulness", SUMMARY_PREFIX),
    },
    {
      id: "totalQuestions",
      header: "Q&A",
      cell: (item) => {
        const total = text(item.total_questions) || "n/a";
        const failed = failedQuestionCount(item);
        if (failed === 0) return total;
        return (
          <Tooltip title={`${failed} of these questions could not be scored and are excluded from the averages.`} arrow>
            <span style={{ cursor: "help" }}>
              {total} <Typography component="span" variant="caption" color="error">({failed} failed)</Typography>
            </span>
          </Tooltip>
        );
      },
      width: "90px",
    },
    {
      id: "viewDetails",
      header: "",
      cell: (item) => (
        <ViewDetailsButton
          evaluationId={text(item.EvaluationId)}
          evalName={text(item.evaluation_name) || undefined}
        />
      ),
      disableSort: true,
      width: "80px",
    },
  ];

  const onDeleteEvaluation = options?.onDeleteEvaluation;
  if (onDeleteEvaluation) {
    EVAL_SUMMARY_COLUMN_DEFINITIONS.push({
      id: "deleteEval",
      header: "",
      cell: (item) => (
        <IconButton
          size="small"
          color="error"
          aria-label={`Delete evaluation ${text(item.evaluation_name) || text(item.EvaluationId)}`}
          onClick={() => onDeleteEvaluation(item)}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      ),
      disableSort: true,
      width: "48px",
    });
  }

  const DETAILED_EVAL_COLUMN_DEFINITIONS: ColumnDefinition[] = [
    {
      id: "question",
      header: "Question",
      cell: (item) => <TruncatedTextCell text={text(item.question, "N/A")} maxLength={50} />,
    },
    {
      id: "expectedResponse",
      header: "Expected",
      cell: (item) => <TruncatedTextCell text={text(item.expected_response, "N/A")} maxLength={40} />,
    },
    {
      id: "actualResponse",
      header: "Actual",
      cell: (item) => {
        const actual = text(item.actual_response);
        if (!actual && isFailedRow(item)) {
          return (
            <Typography variant="body2" color="error">
              {failureReason(item) || "Evaluation failed for this question."}
            </Typography>
          );
        }
        return <TruncatedTextCell text={actual || "N/A"} maxLength={40} />;
      },
    },
    {
      id: "answerQ",
      header: <HeaderWithInfo label="Answer" tooltip={METRIC_DESCRIPTIONS.answerQuality.short} />,
      cell: (item) =>
        isFailedRow(item) ? (
          <FailedScore item={item} showChip />
        ) : (
          <GroupScoreChip item={item} group={group("answerQuality")} prefix={QUESTION_PREFIX} hints={DETAIL_HINTS} />
        ),
      sortingField: "correctness",
      sortingComparator: metricSort("correctness", QUESTION_PREFIX),
    },
    {
      id: "retrievalQ",
      header: <HeaderWithInfo label="Retrieval" tooltip={METRIC_DESCRIPTIONS.retrievalQuality.short} />,
      cell: (item) =>
        isFailedRow(item) ? (
          <FailedScore item={item} showChip={false} />
        ) : (
          <GroupScoreChip item={item} group={group("retrievalQuality")} prefix={QUESTION_PREFIX} hints={DETAIL_HINTS} />
        ),
      sortingField: "context_precision",
      sortingComparator: metricSort("context_precision", QUESTION_PREFIX),
    },
    {
      id: "responseQ",
      header: <HeaderWithInfo label="Response" tooltip={METRIC_DESCRIPTIONS.responseQuality.short} />,
      cell: (item) =>
        isFailedRow(item) ? (
          <FailedScore item={item} showChip={false} />
        ) : (
          <GroupScoreChip item={item} group={group("responseQuality")} prefix={QUESTION_PREFIX} hints={DETAIL_HINTS} />
        ),
      sortingField: "faithfulness",
      sortingComparator: metricSort("faithfulness", QUESTION_PREFIX),
    },
    {
      id: "retrievedContext",
      header: "Retrieved context",
      cell: (item) => (
        <Tooltip title="Preview of retrieved KB chunks (source and relevance in full view).">
          <span>
            <TruncatedTextCell text={text(item.retrieved_context, "N/A")} maxLength={40} />
          </span>
        </Tooltip>
      ),
    },
  ];

  const FEEDBACK_COLUMN_DEFINITIONS: ColumnDefinition[] = [
    {
      id: "problem",
      header: "Problem",
      cell: (item) => (
        <Button
          onClick={() => onProblemClick(item)}
          variant="text"
          size="small"
          aria-label={text(item.Problem) || `View feedback ${text(item.FeedbackID)}`}
        >
          {text(item.Problem, "View")}
        </Button>
      ),
    },
    { id: "topic", header: "Topic", cell: (item) => text(item.Topic) },
    { id: "createdAt", header: "Submission date", cell: (item) => formatDate(item.CreatedAt) },
    { id: "prompt", header: "User Prompt", cell: (item) => text(item.UserPrompt) },
  ];

  const FILES_COLUMN_DEFINITIONS: ColumnDefinition[] = [
    { id: "name", header: "Name", cell: (item) => text(item.Key) },
    { id: "createdAt", header: "Upload date", cell: (item) => formatDate(item.LastModified) },
    {
      id: "size",
      header: "Size",
      cell: (item) => Utils.bytesToSize(typeof item.Size === "number" ? item.Size : 0),
    },
    {
      id: "syncStatus",
      header: (
        <HeaderWithInfo
          label="Sync"
          tooltip="Whether this file is in the knowledge base yet. New uploads stay \u201cNot synced\u201d until you click \u201cSync data now\u201d. Updated when you refresh or run a sync."
        />
      ),
      cell: (item) => {
        // While Bedrock status is still loading we render a skeleton chip
        // instead of defaulting to "Not synced", which would lie to admins
        // for the first second or two of every page load.
        if (item.SyncStatus === undefined && options?.syncStatusLoading) {
          return <Skeleton variant="rounded" width={72} height={24} />;
        }
        const chip = SYNC_STATUS_CHIPS[text(item.SyncStatus)] ?? SYNC_STATUS_CHIPS.not_yet_synced;
        return (
          <Tooltip title={chip.tip} arrow>
            <Chip label={chip.label} color={chip.color} size="small" variant="outlined" sx={{ cursor: "help" }} />
          </Tooltip>
        );
      },
      width: "120px",
    },
    {
      id: "metadata",
      header: (
        <HeaderWithInfo
          label="Summary"
          tooltip="Whether this file has an AI-generated summary yet. The chatbot uses these summaries to know what each document covers. Files without one still work in search but won't be surfaced as cleanly. Summaries are created automatically within about an hour after a file is synced; 'Missing' that persists longer than that means generation failed and will be retried automatically."
        />
      ),
      cell: (item) =>
        item.HasMetadata ? (
          <Chip label="Ready" color="success" size="small" variant="outlined" />
        ) : (
          <Chip label="Missing" color="warning" size="small" variant="outlined" />
        ),
      width: "120px",
    },
  ];

  switch (documentType) {
    case "file":
      return FILES_COLUMN_DEFINITIONS;
    case "feedback":
      return FEEDBACK_COLUMN_DEFINITIONS;
    case "evaluationSummary":
      return EVAL_SUMMARY_COLUMN_DEFINITIONS;
    case "detailedEvaluation":
      return DETAILED_EVAL_COLUMN_DEFINITIONS;
    default:
      return [];
  }
}
