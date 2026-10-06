import React, { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import PeopleIcon from "@mui/icons-material/People";
import ChatIcon from "@mui/icons-material/Chat";
import ForumIcon from "@mui/icons-material/Forum";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import PersonIcon from "@mui/icons-material/Person";
import DownloadIcon from "@mui/icons-material/Download";
import { LineChart } from "@mui/x-charts/LineChart";
import type { DailyBreakdownRow, MetricsOverview } from "../../../common/api-client/metrics-client";
import KPICard from "./kpi-card";
import EmptyHint from "./empty-hint";
import { CSVRow, downloadCSV, rangeFilename } from "./csv";

// ---------- Overview tab ----------

type OverviewSortKey = "date" | "sessions" | "messages" | "unique_users";
type SortDir = "asc" | "desc";

function DailyRow({ day }: { day: DailyBreakdownRow }) {
  const [open, setOpen] = useState(false);
  const dayUsers = day.users ?? [];
  const hasUsers = dayUsers.length > 0;

  return (
    <React.Fragment>
      <TableRow
        hover
        sx={{ cursor: hasUsers ? "pointer" : "default" }}
        onClick={() => hasUsers && setOpen((v) => !v)}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (hasUsers && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        tabIndex={hasUsers ? 0 : undefined}
        aria-expanded={hasUsers ? open : undefined}
        aria-controls={hasUsers ? `daily-users-${day.date}` : undefined}
      >
        <TableCell width={50}>
          {hasUsers && (
            <IconButton size="small" aria-label={open ? "Collapse" : "Expand"}>
              {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          )}
        </TableCell>
        <TableCell>{day.date}</TableCell>
        <TableCell align="right">{day.sessions.toLocaleString()}</TableCell>
        <TableCell align="right">{day.messages.toLocaleString()}</TableCell>
        <TableCell align="right">{day.unique_users.toLocaleString()}</TableCell>
      </TableRow>
      {hasUsers && (
        <TableRow>
          <TableCell colSpan={5} sx={{ py: 0, borderBottom: open ? undefined : "none" }}>
            <Collapse in={open} timeout={200} unmountOnExit id={`daily-users-${day.date}`}>
              <Box sx={{ py: 1, pl: 7, pr: 2, pb: 1.5 }}>
                <Table size="small" aria-label={`Users for ${day.date}`}>
                  <TableHead>
                    <TableRow>
                      <TableCell>User (Email)</TableCell>
                      <TableCell align="right">Sessions</TableCell>
                      <TableCell align="right">Messages</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dayUsers.map((u) => (
                      <TableRow key={u.user_id}>
                        <TableCell>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <PersonIcon fontSize="small" color="action" />
                            <Typography variant="body2">{u.display_name}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell align="right">{u.sessions}</TableCell>
                        <TableCell align="right">{u.messages}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </React.Fragment>
  );
}

interface SortHeaderProps {
  column: OverviewSortKey;
  label: string;
  sortKey: OverviewSortKey;
  sortDir: SortDir;
  onSort: (key: OverviewSortKey) => void;
  align?: "right";
}

function SortHeader({ column, label, sortKey, sortDir, onSort, align }: SortHeaderProps) {
  const active = sortKey === column;
  return (
    <TableCell align={align} sortDirection={active ? sortDir : false}>
      <TableSortLabel active={active} direction={active ? sortDir : "asc"} onClick={() => onSort(column)}>
        {label}
      </TableSortLabel>
    </TableCell>
  );
}

function ActivityChart({ daily, rangeLabel }: { daily: DailyBreakdownRow[]; rangeLabel: string }) {
  const dates = daily.map((d) => d.date);
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h4" component="h2" gutterBottom>
          Activity Over Time
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {rangeLabel}
        </Typography>
        <Typography id="chart-activity-desc" component="p" variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Line chart: sessions, messages, and unique users per day. Each series uses a distinct color
          in the legend; the same numbers appear in the daily breakdown table below.
        </Typography>
        <Box role="group" aria-labelledby="chart-activity-desc" sx={{ width: "100%", height: 350 }}>
          <LineChart
            xAxis={[
              {
                data: dates.map((_, i) => i),
                valueFormatter: (v: number) => dates[v] ?? "",
                scaleType: "point",
              },
            ]}
            series={[
              { data: daily.map((d) => d.sessions), label: "Sessions" },
              { data: daily.map((d) => d.messages), label: "Messages" },
              { data: daily.map((d) => d.unique_users), label: "Unique Users" },
            ]}
            height={320}
          />
        </Box>
      </CardContent>
    </Card>
  );
}

export default function OverviewTab({
  metrics,
  prior,
  rangeLabel,
}: {
  metrics: MetricsOverview;
  prior: MetricsOverview | null;
  rangeLabel: string;
}) {
  const [sortKey, setSortKey] = useState<OverviewSortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const daily = useMemo(
    () => [...metrics.daily_breakdown].sort((a, b) => a.date.localeCompare(b.date)),
    [metrics.daily_breakdown]
  );

  const sortedDaily = useMemo(() => {
    const copy = [...metrics.daily_breakdown];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [metrics.daily_breakdown, sortKey, sortDir]);

  const toggleSort = (key: OverviewSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("desc");
  };

  const exportCSV = () => {
    const rows: CSVRow[] = [
      ["Date", "Sessions", "Messages", "Unique Users"],
      ...sortedDaily.map((d) => [d.date, d.sessions, d.messages, d.unique_users]),
    ];
    downloadCSV(rangeFilename("overview", metrics.range), rows);
  };

  const headerProps = { sortKey, sortDir, onSort: toggleSort };

  return (
    <Box sx={{ mt: 3 }}>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KPICard title="Total Users" value={metrics.unique_users} previous={prior?.unique_users} icon={<PeopleIcon />} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KPICard title="Total Sessions" value={metrics.total_sessions} previous={prior?.total_sessions} icon={<ChatIcon />} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KPICard title="Total Messages" value={metrics.total_messages} previous={prior?.total_messages} icon={<ForumIcon />} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KPICard title="Avg Msgs/Session" value={metrics.avg_messages_per_session} previous={prior?.avg_messages_per_session} icon={<TrendingUpIcon />} />
        </Grid>
      </Grid>

      {metrics.peak_hour && metrics.peak_hour !== "N/A" && (
        <Alert icon={<AccessTimeIcon />} severity="info" sx={{ mb: 3 }}>
          Peak usage hour: <strong>{metrics.peak_hour}</strong>
        </Alert>
      )}

      {daily.length > 1 && <ActivityChart daily={daily} rangeLabel={rangeLabel} />}

      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h4" component="h2">
              Daily Breakdown
            </Typography>
            <Button size="small" startIcon={<DownloadIcon />} onClick={exportCSV} disabled={sortedDaily.length === 0}>
              Export CSV
            </Button>
          </Stack>
          {sortedDaily.length === 0 ? (
            <EmptyHint message="No activity in this range or hour window." />
          ) : (
            <TableContainer>
              <Table size="small" aria-label="Daily breakdown">
                <TableHead>
                  <TableRow>
                    <TableCell width={50} />
                    <SortHeader column="date" label="Date" {...headerProps} />
                    <SortHeader column="sessions" label="Sessions" align="right" {...headerProps} />
                    <SortHeader column="messages" label="Messages" align="right" {...headerProps} />
                    <SortHeader column="unique_users" label="Unique Users" align="right" {...headerProps} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedDaily.map((day) => (
                    <DailyRow key={day.date} day={day} />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
