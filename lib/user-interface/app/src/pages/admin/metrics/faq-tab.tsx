import React, { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  IconButton,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import SearchIcon from "@mui/icons-material/Search";
import DownloadIcon from "@mui/icons-material/Download";
import { BarChart } from "@mui/x-charts/BarChart";
import type { FAQInsights, FAQTopic } from "../../../common/api-client/metrics-client";
import EmptyHint from "./empty-hint";
import { CSVRow, downloadCSV, rangeFilename } from "./csv";

// ---------- FAQ tab ----------

const CHART_TOPIC_LIMIT = 10;

function FAQRow({ topic }: { topic: FAQTopic }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TableRow
        hover
        sx={{ cursor: "pointer" }}
        onClick={() => setOpen(!open)}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(!open); } }}
        tabIndex={0}
        aria-expanded={open}
        aria-controls={`faq-details-${topic.topic}`}
      >
        <TableCell>
          <IconButton size="small" aria-label={open ? "Collapse" : "Expand"}>
            {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </TableCell>
        <TableCell>
          <Chip label={topic.topic} size="small" variant="outlined" />
        </TableCell>
        <TableCell align="right">
          <Typography fontWeight="bold">{topic.count}</Typography>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={3} sx={{ py: 0, borderBottom: open ? undefined : "none" }}>
          <Collapse in={open} timeout={200} unmountOnExit id={`faq-details-${topic.topic}`}>
            <Box sx={{ py: 1.5, pl: 6 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Sample questions:
              </Typography>
              {topic.sample_questions.map((sample, i) => {
                return (
                  <Box key={i} sx={{ py: 0.3 }}>
                    <Typography variant="body2" component="span">
                      &bull; {sample.question}
                    </Typography>
                    {sample.display_name && (
                      <Typography variant="caption" color="text.secondary" component="span" sx={{ ml: 1 }}>
                        ({sample.display_name})
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

function TopTopicsChart({ topics }: { topics: FAQTopic[] }) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h4" component="h2" gutterBottom>
          Top Topics
        </Typography>
        <Typography id="chart-faq-topics-desc" component="p" variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Horizontal bar chart: question count per topic. Bar color shows magnitude; exact counts are
          in the All Topics table below.
        </Typography>
        <Box role="group" aria-labelledby="chart-faq-topics-desc" sx={{ width: "100%", height: 350 }}>
          <BarChart
            yAxis={[{ data: topics.map((t) => t.topic), scaleType: "band" }]}
            xAxis={[{ label: "Questions" }]}
            series={[{ data: topics.map((t) => t.count), label: "Questions" }]}
            layout="horizontal"
            height={320}
            margin={{ left: 160 }}
          />
        </Box>
      </CardContent>
    </Card>
  );
}

function FAQEmptyState() {
  return (
    <Box sx={{ mt: 3, textAlign: "center", py: 8 }}>
      <Typography variant="h4" component="h2" color="text.secondary">
        No FAQ data yet
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 400, mx: "auto" }}>
        FAQ insights will appear here once users start chatting. Questions are
        automatically classified by topic.
      </Typography>
    </Box>
  );
}

export default function FAQTab({
  faqData,
  rangeLabel,
}: {
  faqData: FAQInsights | null;
  rangeLabel: string;
}) {
  const [search, setSearch] = useState("");
  const [minCount, setMinCount] = useState(0);

  const filtered = useMemo(() => {
    if (!faqData) return [];
    const q = search.trim().toLowerCase();
    return faqData.topics.filter((t) => {
      if (t.count < minCount) return false;
      if (!q) return true;
      if (t.topic.toLowerCase().includes(q)) return true;
      return t.sample_questions.some((s) => s.question.toLowerCase().includes(q));
    });
  }, [faqData, search, minCount]);

  if (!faqData || faqData.topics.length === 0) return <FAQEmptyState />;

  const exportCSV = () => {
    const rows: CSVRow[] = [
      ["Topic", "Count", "Sample Questions"],
      ...filtered.map((t) => [t.topic, t.count, t.sample_questions.map((s) => s.question).join(" | ")]),
    ];
    downloadCSV(rangeFilename("faq", faqData.range), rows);
  };

  const chartTopics = filtered.slice(0, CHART_TOPIC_LIMIT);

  return (
    <Box sx={{ mt: 3 }}>
      <Alert severity="info" sx={{ mb: 3 }}>
        <strong>{faqData.total_classified}</strong> questions classified in <strong>{rangeLabel}</strong> across{" "}
        <strong>{faqData.topics.length}</strong> topics
      </Alert>

      <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          placeholder="Search topics or questions"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          sx={{ minWidth: 280 }}
        />
        <TextField
          size="small"
          type="number"
          label="Min count"
          value={minCount}
          onChange={(e) => setMinCount(Math.max(0, Number.parseInt(e.target.value || "0", 10)))}
          inputProps={{ min: 0 }}
          sx={{ width: 120 }}
        />
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<DownloadIcon />} onClick={exportCSV} disabled={filtered.length === 0}>
          Export CSV
        </Button>
      </Stack>

      {chartTopics.length > 0 && <TopTopicsChart topics={chartTopics} />}

      <Card>
        <CardContent>
          <Typography variant="h4" component="h2" gutterBottom>
            All Topics
          </Typography>
          {filtered.length === 0 ? (
            <EmptyHint message="No topics match the current search / threshold." />
          ) : (
            <TableContainer>
              <Table size="small" aria-label="FAQ topics">
                <TableHead>
                  <TableRow>
                    <TableCell width={50} />
                    <TableCell>Topic</TableCell>
                    <TableCell align="right">Count</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((topic) => (
                    <FAQRow key={topic.topic} topic={topic} />
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
