import { Box, Button, Chip, Tooltip, Typography } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useNavigate } from "react-router-dom";
import {
  MetricGroup,
  MetricKey,
  MetricPrefix,
  MetricRecord,
  METRIC_LABELS,
  failureReason,
  groupScorePct,
  readMetric,
  scoreBand,
  scoreColor,
  toPct,
} from "./eval-metrics";

/** Good / fair / poor hint text for one metric. */
export type MetricHints = Partial<Record<MetricKey, readonly [string, string, string]>>;

export function HeaderWithInfo({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <Tooltip
      title={<Typography variant="body2" sx={{ p: 0.5 }}>{tooltip}</Typography>}
      placement="top"
      arrow
      enterDelay={200}
    >
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, cursor: "help" }}>
        {label}
        <InfoOutlinedIcon sx={{ fontSize: 14, color: "text.secondary" }} />
      </Box>
    </Tooltip>
  );
}

function CellTooltipContent({ metrics }: { metrics: { label: string; pct: number; hint: string }[] }) {
  return (
    <Box sx={{ p: 0.5 }}>
      {metrics.map((m) => (
        <Typography key={m.label} variant="body2" sx={{ mb: 0.5 }}>
          <strong>{m.label}: {m.pct.toFixed(0)}%</strong> ({scoreBand(m.pct, "Good", "Needs improvement", "Poor")})
          <br />
          <span style={{ opacity: 0.85, fontSize: "0.85em" }}>{m.hint}</span>
        </Typography>
      ))}
    </Box>
  );
}

/**
 * Chip showing a group's score for one row. Only metrics the row carries are
 * averaged and listed; a group with no metrics renders "n/a".
 */
export function GroupScoreChip({
  item,
  group,
  prefix,
  hints,
  bold,
}: {
  item: MetricRecord;
  group: MetricGroup;
  prefix: MetricPrefix;
  hints: MetricHints;
  bold?: boolean;
}) {
  const avg = groupScorePct(item, group, prefix);
  if (avg === null) {
    return (
      <Tooltip title="Not measured in this run" arrow>
        <Typography variant="body2" color="text.secondary" component="span" sx={{ cursor: "help" }}>
          n/a
        </Typography>
      </Tooltip>
    );
  }
  const metrics = group.metrics.flatMap((key) => {
    const pct = toPct(readMetric(item, key, prefix));
    if (pct === null) return [];
    const bands = hints[key];
    const hint = bands ? scoreBand(pct, bands[0], bands[1], bands[2]) : "";
    return [{ label: METRIC_LABELS[key], pct, hint }];
  });
  return (
    <Tooltip title={<CellTooltipContent metrics={metrics} />} arrow>
      <Chip
        label={`${avg.toFixed(0)}%`}
        color={scoreColor(avg)}
        size="small"
        variant="outlined"
        sx={{ cursor: "help", ...(bold ? { fontWeight: "bold" } : {}) }}
      />
    </Tooltip>
  );
}

/** Score cell for a question the pipeline could not score. */
export function FailedScore({ item, showChip }: { item: MetricRecord; showChip: boolean }) {
  if (!showChip) {
    return (
      <Typography variant="body2" color="text.secondary" component="span">
        n/a
      </Typography>
    );
  }
  const reason = failureReason(item) || "This question could not be evaluated.";
  return (
    <Tooltip title={reason} arrow>
      <Chip label="Failed" color="error" size="small" variant="outlined" sx={{ cursor: "help" }} />
    </Tooltip>
  );
}

export function ViewDetailsButton({ evaluationId, evalName }: { evaluationId: string; evalName?: string }) {
  const navigate = useNavigate();
  const qs = evalName ? `?name=${encodeURIComponent(evalName)}` : "";
  return (
    <Button
      onClick={() => navigate(`/admin/llm-evaluation/details/${evaluationId}${qs}`)}
      variant="text"
      size="small"
    >
      View
    </Button>
  );
}
