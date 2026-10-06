import {
  Typography,
  Stack,
  Paper,
  Alert,
  LinearProgress,
  Box,
  Button,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Tooltip,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { LineChart } from "@mui/x-charts/LineChart";
import { useState, useEffect, useMemo, useContext, useCallback } from "react";
import { ApiClient } from "../../common/api-client/api-client";
import type { EvaluationSummary } from "../../common/api-client/evaluations-client";
import { AppContext } from "../../common/app-context";
import { Utils } from "../../common/utils";
import { brand } from "../../common/brand";
import {
  CHARTED_METRICS,
  METRIC_DESCRIPTIONS,
  METRIC_GROUPS,
  METRIC_LABELS,
  METRIC_TOOLTIPS,
  MetricGroup,
  SUMMARY_PREFIX,
  failedQuestionCount,
  failedQuestionsLabel,
  groupScorePct,
  hasAnyScore,
  presentMetrics,
  readMetric,
  scoreBgKey,
  scoreColor,
  serverTimestampMs,
  toPct,
} from "./eval-metrics";

interface DashboardProps {
  onRunEval: () => void;
  onViewLibrary: () => void;
}

const GROUP_COLORS: Record<MetricGroup["id"], string> = {
  answerQuality: "#4caf50",
  retrievalQuality: "#ff9800",
  responseQuality: "#2196f3",
};

const SUMMARY_PAGE_SIZE = 50;

interface ScoreMetric {
  label: string;
  value: number;
  tooltip: string;
}

function ScoreCard({
  title,
  pct,
  metrics,
  description,
}: {
  title: string;
  pct: number;
  metrics: ScoreMetric[];
  description: string;
}) {
  return (
    <Paper sx={{ p: 2.5, bgcolor: scoreBgKey(pct), height: "100%" }}>
      <Tooltip
        title={<Typography variant="body2" sx={{ p: 0.5 }}>{description}</Typography>}
        placement="top"
        arrow
        enterDelay={200}
      >
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ cursor: "help", mb: 0.5 }}>
          <Typography variant="subtitle2" color="text.secondary">
            {title}
          </Typography>
          <InfoOutlinedIcon sx={{ fontSize: 14, color: "text.secondary" }} />
        </Stack>
      </Tooltip>
      <Stack direction="row" alignItems="baseline" spacing={1}>
        <Typography variant="h4" fontWeight="bold">
          {pct.toFixed(0)}%
        </Typography>
        <Chip label={scoreColor(pct)} color={scoreColor(pct)} size="small" />
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(pct, 100)}
        color={scoreColor(pct)}
        sx={{ height: 6, borderRadius: 3, my: 1.5 }}
      />
      {metrics.map((m) => (
        <Tooltip key={m.label} title={m.tooltip} placement="right" arrow>
          <Typography variant="body2" color="text.secondary" sx={{ cursor: "help" }}>
            {m.label}: {m.value.toFixed(0)}%
          </Typography>
        </Tooltip>
      ))}
    </Paper>
  );
}

/** Metrics of `group` the summary row actually carries, as percentages. */
function groupMetrics(item: EvaluationSummary, group: MetricGroup): ScoreMetric[] {
  return group.metrics.flatMap((key) => {
    const value = toPct(readMetric(item, key, SUMMARY_PREFIX));
    return value === null
      ? []
      : [{ label: METRIC_LABELS[key], value, tooltip: METRIC_TOOLTIPS[key] }];
  });
}

const formatChartDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: brand.timezone });

export default function CurrentEvalTab({ onRunEval, onViewLibrary }: DashboardProps) {
  const appContext = useContext(AppContext);
  const apiClient = useMemo(() => new ApiClient(appContext!), [appContext]);
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runningEval, setRunningEval] = useState<EvaluationSummary | null>(null);

  const getEvaluations = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await apiClient.evaluations.getEvaluationSummaries(undefined, SUMMARY_PAGE_SIZE);
      const running = result.Items.find(
        (e) => e.status === "RUNNING" || (Boolean(e.executionArn) && !hasAnyScore(e))
      );
      setRunningEval(running ?? null);
      setEvaluations(result.Items.filter((e) => hasAnyScore(e)));
    } catch (error) {
      setEvaluations([]);
      setLoadError(Utils.getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    getEvaluations();
  }, [getEvaluations]);

  if (loading) {
    return (
      <Box
        role="status"
        aria-label="Loading evaluation"
        sx={{ display: "flex", justifyContent: "center", py: 6 }}
      >
        <CircularProgress aria-hidden="true" />
      </Box>
    );
  }

  if (loadError) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => getEvaluations()}>
            Retry
          </Button>
        }
      >
        Could not load evaluations: {loadError}
      </Alert>
    );
  }

  if (evaluations.length === 0) {
    return (
      <Paper sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" component="h2" gutterBottom>
          No evaluations yet
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Run your first evaluation to see performance metrics and trends.
        </Typography>
        <Button variant="contained" onClick={onRunEval}>
          Run Evaluation
        </Button>
      </Paper>
    );
  }

  const latest = evaluations[0];
  const latestGroups = METRIC_GROUPS.flatMap((group) => {
    const pct = groupScorePct(latest, group, SUMMARY_PREFIX);
    return pct === null ? [] : [{ group, pct }];
  });

  const sorted = [...evaluations].sort(
    (a, b) => (serverTimestampMs(a.Timestamp) || 0) - (serverTimestampMs(b.Timestamp) || 0)
  );
  const timestamps = sorted.map((e) => new Date(serverTimestampMs(e.Timestamp)));
  // Missing values are null so the chart leaves a gap instead of plotting 0.
  const trendSeries = METRIC_GROUPS.filter((group) =>
    sorted.some((e) => groupScorePct(e, group, SUMMARY_PREFIX) !== null)
  ).map((group) => ({
    data: sorted.map((e) => groupScorePct(e, group, SUMMARY_PREFIX)),
    label: group.label,
    color: GROUP_COLORS[group.id],
    connectNulls: true,
  }));
  const metricSeries = presentMetrics(sorted, CHARTED_METRICS, SUMMARY_PREFIX).map((key) => ({
    data: sorted.map((e) => toPct(readMetric(e, key, SUMMARY_PREFIX))),
    label: METRIC_LABELS[key],
    connectNulls: true,
  }));
  const latestDate = serverTimestampMs(latest.Timestamp);
  const latestFailed = failedQuestionCount(latest);

  return (
    <Stack spacing={3}>
      {runningEval && (
        <Alert severity="info" action={<Button size="small" onClick={onRunEval}>View Progress</Button>}>
          Evaluation &ldquo;{runningEval.evaluation_name || "Unnamed"}&rdquo; is in progress.
        </Alert>
      )}

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="subtitle2" color="text.secondary">
            Latest: {latest.evaluation_name || "Unnamed"}
            {Number.isNaN(latestDate) ? "" : ` (${Utils.formatTimestamp(new Date(latestDate).toISOString())})`}
          </Typography>
          {latestFailed > 0 && (
            <Tooltip title="These questions could not be scored and are excluded from the averages below." arrow>
              <Chip label={failedQuestionsLabel(latestFailed)} color="error" size="small" variant="outlined" />
            </Tooltip>
          )}
        </Stack>
      </Paper>

      <Grid container spacing={2}>
        {latestGroups.map(({ group, pct }) => (
          <Grid key={group.id} size={{ xs: 12, md: 12 / latestGroups.length }}>
            <ScoreCard
              title={group.label}
              pct={pct}
              description={METRIC_DESCRIPTIONS[group.id].detail}
              metrics={groupMetrics(latest, group)}
            />
          </Grid>
        ))}
      </Grid>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Performance Trends
        </Typography>
        {timestamps.length > 1 ? (
          <Box sx={{ width: "100%", height: 350 }}>
            <LineChart
              xAxis={[{ data: timestamps, scaleType: "time", valueFormatter: formatChartDate }]}
              yAxis={[{ min: 0, max: 100, valueFormatter: (v: number) => `${v}%` }]}
              series={trendSeries}
              height={320}
            />
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
            Need at least 2 evaluations to show trends
          </Typography>
        )}
      </Paper>

      {timestamps.length > 1 && (
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1">Individual Metrics</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ width: "100%", height: 350 }}>
              <LineChart
                xAxis={[{ data: timestamps, scaleType: "time", valueFormatter: formatChartDate }]}
                yAxis={[{ min: 0, max: 100, valueFormatter: (v: number) => `${v}%` }]}
                series={metricSeries}
                height={320}
              />
            </Box>
          </AccordionDetails>
        </Accordion>
      )}

      <Stack direction="row" spacing={2}>
        <Button variant="contained" onClick={onRunEval}>
          Run New Evaluation
        </Button>
        <Button variant="outlined" onClick={onViewLibrary}>
          View Test Library
        </Button>
      </Stack>
    </Stack>
  );
}
