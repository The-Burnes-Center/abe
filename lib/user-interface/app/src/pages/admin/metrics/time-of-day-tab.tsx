import React, { useMemo } from "react";
import { Box, Button, Card, CardContent, Stack, Tooltip, Typography } from "@mui/material";
import Grid from "@mui/material/Grid2";
import { alpha, useTheme } from "@mui/material/styles";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import ForumIcon from "@mui/icons-material/Forum";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import DownloadIcon from "@mui/icons-material/Download";
import type { HourlyBucket, MetricsOverview } from "../../../common/api-client/metrics-client";
import { brand } from "../../../common/brand";
import { Utils } from "../../../common/utils";
import KPICard from "./kpi-card";
import EmptyHint from "./empty-hint";
import { CSVRow, downloadCSV, rangeFilename } from "./csv";

// ---------- Time of Day tab ----------

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS_PER_DAY = 24;
const BUSINESS_HOUR_START = 9;
const BUSINESS_HOUR_END = 17;
const LEGEND_STEPS = [0.15, 0.3, 0.5, 0.7, 0.85];

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

function summarizeHours(hourly: HourlyBucket[]) {
  let peak: HourlyBucket | null = null;
  let business = 0;
  let off = 0;
  for (const h of hourly) {
    if (h.sessions > (peak?.sessions ?? -1)) peak = h;
    const hour = Number.parseInt(h.hour.slice(0, 2), 10);
    if (hour >= BUSINESS_HOUR_START && hour <= BUSINESS_HOUR_END) business += h.sessions;
    else off += h.sessions;
  }
  const total = business + off;
  return { peak, business, offHoursPct: total > 0 ? (off / total) * 100 : 0 };
}

function HeatmapLegend() {
  const theme = useTheme();
  return (
    <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
      <Typography variant="caption" color="text.secondary">
        Less
      </Typography>
      <Stack direction="row" spacing={0.5}>
        {LEGEND_STEPS.map((p) => (
          <Box
            key={p}
            sx={{ width: 18, height: 18, borderRadius: 0.5, bgcolor: alpha(theme.palette.primary.main, p) }}
          />
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        More
      </Typography>
    </Stack>
  );
}

function HeatmapGrid({ matrix, max }: { matrix: number[][]; max: number }) {
  const theme = useTheme();
  const cellColor = (v: number) => {
    if (v === 0) return alpha(theme.palette.action.disabledBackground, 0.4);
    const intensity = Math.min(1, v / max);
    return alpha(theme.palette.primary.main, 0.15 + intensity * 0.7);
  };

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "60px repeat(7, 1fr)", gap: 0.5, minWidth: 560 }}>
        <Box />
        {DAY_LABELS.map((d) => (
          <Box key={d} sx={{ textAlign: "center" }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>
              {d}
            </Typography>
          </Box>
        ))}
        {Array.from({ length: HOURS_PER_DAY }, (_, h) => (
          <React.Fragment key={h}>
            <Box sx={{ textAlign: "right", pr: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {hourLabel(h)}
              </Typography>
            </Box>
            {DAY_LABELS.map((day, d) => {
              const v = matrix[h]?.[d] ?? 0;
              return (
                <Tooltip key={d} title={`${day} ${hourLabel(h)}: ${v} messages`}>
                  <Box
                    sx={{
                      bgcolor: cellColor(v),
                      borderRadius: 0.5,
                      height: 22,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "default",
                    }}
                    aria-label={`${day} ${h}:00 ${v} messages`}
                  >
                    {v > 0 && max > 0 && v / max > 0.5 && (
                      <Typography variant="caption" sx={{ fontSize: 10, color: "primary.contrastText" }}>
                        {v}
                      </Typography>
                    )}
                  </Box>
                </Tooltip>
              );
            })}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

export default function TimeOfDayTab({ metrics }: { metrics: MetricsOverview }) {
  const matrix = useMemo(() => metrics.hour_by_weekday ?? [], [metrics.hour_by_weekday]);
  const max = useMemo(() => Math.max(0, ...matrix.flat()), [matrix]);
  const { peak, business, offHoursPct } = summarizeHours(metrics.hourly_distribution ?? []);
  const tzLabel = Utils.timezoneLabel();

  const exportCSV = () => {
    const rows: CSVRow[] = [["Hour", ...DAY_LABELS]];
    for (let h = 0; h < HOURS_PER_DAY; h++) {
      rows.push([hourLabel(h), ...DAY_LABELS.map((_, d) => matrix[h]?.[d] ?? 0)]);
    }
    downloadCSV(rangeFilename("time-of-day", metrics.range), rows);
  };

  if (max === 0) {
    return (
      <Box sx={{ mt: 3 }}>
        <EmptyHint message="No activity in the selected range. Try a wider date range or removing the hour filter." />
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 3 }}>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <KPICard
            title={`Peak Hour (${tzLabel})`}
            value={peak ? `${peak.hour} ${tzLabel}` : "N/A"}
            icon={<AccessTimeIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <KPICard title="Business-Hours Messages" value={business} icon={<ForumIcon />} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <KPICard title="Off-Hours %" value={`${offHoursPct.toFixed(1)}%`} icon={<TrendingUpIcon />} />
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h4" component="h2">
              Hour × Day-of-Week Heatmap
            </Typography>
            <Button size="small" startIcon={<DownloadIcon />} onClick={exportCSV}>
              Export CSV
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Message volume by hour of day (rows) and day of week (columns). All times in{" "}
            {brand.timezone} ({tzLabel}). Darker = more activity.
          </Typography>

          <HeatmapGrid matrix={matrix} max={max} />
          <HeatmapLegend />
        </CardContent>
      </Card>
    </Box>
  );
}
