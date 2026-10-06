import { useState, useEffect, useContext, useRef, useMemo, useCallback } from "react";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  TableSortLabel,
  Paper,
  Typography,
  Button,
  Box,
  Breadcrumbs,
  Link,
  CircularProgress,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Tooltip,
  Alert,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { AppContext } from "../../common/app-context";
import { ApiClient } from "../../common/api-client/api-client";
import { Utils } from "../../common/utils";
import { brand } from "../../common/brand";
import { v4 as uuidv4 } from "uuid";
import { ColumnItem, getColumnDefinition } from "./columns";
import {
  METRIC_DESCRIPTIONS,
  METRIC_GROUPS,
  QUESTION_PREFIX,
  aggregateGroupPct,
  failedQuestionsLabel,
  isFailedRow,
  scoreBand,
  scoreBgKey,
  scoreColor,
} from "./eval-metrics";
import type {
  EvaluationResult,
  Page,
  PageToken,
} from "../../common/api-client/evaluations-client";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useDocumentTitle } from "../../common/hooks/use-document-title";
import AdminMarkdown from "../../components/admin-markdown";

const RESULTS_PAGE_SIZE = 100;
const HISTORY_PATH = "/admin/llm-evaluation#history";

function SummaryCard({ title, pct, description }: { title: string; pct: number; description: string }) {
  const tier = scoreBand(pct, "Strong", "Moderate", "Needs improvement");
  const color = scoreColor(pct);
  const summary = `${title}: ${pct.toFixed(0)}%. ${tier} performance band.`;
  return (
    <Tooltip
      title={<Typography variant="body2" sx={{ p: 0.5 }}>{description}</Typography>}
      placement="top"
      arrow
      enterDelay={200}
    >
      <Paper
        component="article"
        aria-label={summary}
        sx={{ p: 2, bgcolor: scoreBgKey(pct), textAlign: "center", cursor: "help" }}
      >
        <Stack direction="row" justifyContent="center" alignItems="center" spacing={0.5}>
          <Typography variant="subtitle2" color="text.secondary" component="h2" sx={{ fontSize: "0.875rem" }}>
            {title}
          </Typography>
          <InfoOutlinedIcon sx={{ fontSize: 14, color: "text.secondary" }} aria-hidden />
        </Stack>
        <Typography variant="h4" fontWeight="bold" component="p" sx={{ my: 0.5 }}>
          {pct.toFixed(0)}%
        </Typography>
        <Chip label={tier} color={color} size="small" variant="outlined" />
      </Paper>
    </Tooltip>
  );
}

function escapeCSVValue(val: unknown): string {
  const str = typeof val === "string" ? val : String(val ?? "");
  const escaped = str.replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(escaped)) {
    return `"'${escaped}"`;
  }
  return `"${escaped}"`;
}

function DetailedEvaluationPage() {
  useDocumentTitle("Admin \u00b7 Quality monitoring \u00b7 Evaluation details");
  const { evaluationId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const appContext = useContext(AppContext);
  const apiClient = useMemo(() => new ApiClient(appContext!), [appContext]);
  const [loading, setLoading] = useState(true);
  const [evaluationName, setEvaluationName] = useState(searchParams.get("name") || "");
  const [currentPageIndex, setCurrentPageIndex] = useState(1);
  const [pages, setPages] = useState<Page<EvaluationResult>[]>([]);
  const needsRefresh = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isContextModalVisible, setContextModalVisible] = useState(false);
  const [selectedContext, setSelectedContext] = useState("");
  const [selectedQuestion, setSelectedQuestion] = useState("");
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [allItems, setAllItems] = useState<EvaluationResult[]>([]);

  const handleContextClick = useCallback((item: ColumnItem) => {
    const context = typeof item.retrieved_context === "string" ? item.retrieved_context : "";
    const question = typeof item.question === "string" ? item.question : "";
    setSelectedContext(context || "No context available");
    setSelectedQuestion(question || "Unknown question");
    setContextModalVisible(true);
  }, []);

  const fetchEvaluationDetails = useCallback(
    async (params: { pageIndex?: number; nextPageToken?: PageToken | null }) => {
      if (!evaluationId) return;
      setLoading(true);
      try {
        const result = await apiClient.evaluations.getEvaluationResults(
          evaluationId,
          params.nextPageToken,
          RESULTS_PAGE_SIZE
        );
        setError(null);
        setPages((current) => {
          if (needsRefresh.current) {
            needsRefresh.current = false;
            return [result];
          }
          if (typeof params.pageIndex !== "undefined") {
            const next = [...current];
            next[params.pageIndex - 1] = result;
            return next;
          }
          return [...current, result];
        });
        if (result.Items.length > 0) {
          const firstName = result.Items[0].evaluation_name;
          if (firstName) setEvaluationName((name) => name || firstName);
          setAllItems(result.Items);
        }
      } catch (error) {
        setError(`Could not load evaluation results: ${Utils.getErrorMessage(error)}`);
      } finally {
        setLoading(false);
      }
    },
    [apiClient, evaluationId]
  );

  useEffect(() => {
    setCurrentPageIndex(1);
    fetchEvaluationDetails({ pageIndex: 1 });
  }, [fetchEvaluationDetails]);

  const columnDefinitions = useMemo(() => {
    const base = getColumnDefinition("detailedEvaluation", () => {});
    return base.map((col) =>
      col.id === "retrievedContext"
        ? {
            ...col,
            cell: (item: ColumnItem) => (
              <Button onClick={() => handleContextClick(item)} variant="text" size="small">
                View
              </Button>
            ),
          }
        : col
    );
  }, [handleContextClick]);

  const currentPageItems = useMemo<EvaluationResult[]>(
    () => pages[Math.min(pages.length - 1, currentPageIndex - 1)]?.Items ?? [],
    [pages, currentPageIndex]
  );

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const sortedItems = useMemo(() => {
    if (!sortField || !currentPageItems.length) return currentPageItems;
    const col = columnDefinitions.find((c) => c.sortingField === sortField);
    const sorted = col?.sortingComparator
      ? [...currentPageItems].sort(col.sortingComparator)
      : [...currentPageItems].sort((a, b) => {
          const aVal = String(a[sortField] ?? "");
          const bVal = String(b[sortField] ?? "");
          return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        });
    return sortDirection === "desc" ? sorted.reverse() : sorted;
  }, [currentPageItems, sortField, sortDirection, columnDefinitions]);

  // Only groups with at least one scored metric get a card; each metric is
  // averaged over the questions that have it (no 0 placeholders).
  const summaryMetrics = useMemo(
    () =>
      METRIC_GROUPS.flatMap((group) => {
        const pct = aggregateGroupPct(allItems, group, QUESTION_PREFIX);
        return pct === null ? [] : [{ group, pct }];
      }),
    [allItems]
  );

  const failedCount = useMemo(
    () => pages.reduce((sum, page) => sum + page.Items.filter((item) => isFailedRow(item)).length, 0),
    [pages]
  );

  const handleDownload = () => {
    if (sortedItems.length === 0) return;
    const headers = Object.keys(sortedItems[0]);
    const rows = sortedItems.map((item) =>
      headers.map((h) => escapeCSVValue(item[h])).join(",")
    );
    const csv = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `evaluation-${evaluationId}.csv`;
    link.click();
  };

  return (
    <Stack spacing={2}>
      <Breadcrumbs aria-label="breadcrumb">
        <Link
          component="button"
          underline="hover"
          color="inherit"
          onClick={() => navigate(`/chatbot/playground/${uuidv4()}`)}
          sx={{ fontSize: "0.8125rem" }}
        >
          {brand.shortName}
        </Link>
        <Link
          component="button"
          underline="hover"
          color="inherit"
          onClick={() => navigate(HISTORY_PATH)}
          sx={{ fontSize: "0.8125rem" }}
        >
          Quality Monitoring
        </Link>
        <Typography color="text.primary" sx={{ fontSize: "0.8125rem" }}>
          {evaluationName || evaluationId}
        </Typography>
      </Breadcrumbs>

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" component="h1">
          Evaluation Details{evaluationName ? `: ${evaluationName}` : ""}
        </Typography>
        <Button onClick={() => navigate(HISTORY_PATH)} variant="text">
          Back to Quality Monitoring
        </Button>
      </Stack>

      {failedCount > 0 && (
        <Alert severity="warning">
          {failedQuestionsLabel(failedCount)}. Failed questions are marked below and excluded from the scores.
        </Alert>
      )}

      {summaryMetrics.length > 0 && (
        <Grid container spacing={2}>
          {summaryMetrics.map(({ group, pct }) => (
            <Grid key={group.id} size={{ xs: 12, md: 12 / summaryMetrics.length }}>
              <SummaryCard title={group.label} pct={pct} description={METRIC_DESCRIPTIONS[group.id].detail} />
            </Grid>
          ))}
        </Grid>
      )}

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h6" component="h2">Per-Question Results</Typography>
        <Button onClick={handleDownload} variant="outlined" size="small">
          Export CSV
        </Button>
      </Stack>

      {loading ? (
        <Box
          role="status"
          aria-label="Loading evaluation details"
          sx={{ display: "flex", justifyContent: "center", p: 4 }}
        >
          <CircularProgress aria-hidden="true" />
        </Box>
      ) : sortedItems.length === 0 ? (
        <Box sx={{ textAlign: "center", p: 4 }}>
          <Chip
            label={error || "No details found"}
            color={error ? "error" : "warning"}
            variant="outlined"
          />
        </Box>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small" aria-label="Per-question evaluation results">
            <TableHead>
              <TableRow>
                {columnDefinitions.map((col) => {
                  const isActiveSort = !!col.sortingField && sortField === col.sortingField;
                  return (
                    <TableCell
                      key={col.id}
                      sortDirection={isActiveSort ? sortDirection : false}
                      aria-sort={
                        col.sortingField
                          ? isActiveSort
                            ? sortDirection === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                          : undefined
                      }
                      sx={{ fontWeight: "bold", ...(col.width ? { width: col.width } : {}) }}
                    >
                      {col.sortingField ? (
                        <TableSortLabel
                          active={isActiveSort}
                          direction={isActiveSort ? sortDirection : "asc"}
                          onClick={() => handleSort(col.sortingField!)}
                        >
                          {col.header}
                        </TableSortLabel>
                      ) : (
                        col.header
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedItems.map((item, index) => (
                <TableRow key={item.question_id || item.QuestionId || index} hover>
                  {columnDefinitions.map((col) => (
                    <TableCell key={col.id}>{col.cell(item)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {pages.length > 0 && (
        <Stack direction="row" justifyContent="center" spacing={2} sx={{ py: 1 }}>
          <Button
            size="small"
            disabled={currentPageIndex <= 1}
            onClick={() => setCurrentPageIndex((c) => Math.max(1, c - 1))}
          >
            Previous
          </Button>
          <Typography variant="body2" sx={{ alignSelf: "center" }}>
            Page {currentPageIndex} of {pages.length}
          </Typography>
          <Button
            size="small"
            disabled={!pages[currentPageIndex - 1]?.NextPageToken}
            onClick={async () => {
              const token = pages[currentPageIndex - 1]?.NextPageToken;
              if (token) {
                await fetchEvaluationDetails({ nextPageToken: token });
                setCurrentPageIndex((c) => c + 1);
              }
            }}
          >
            Next
          </Button>
        </Stack>
      )}

      <Dialog
        open={isContextModalVisible}
        onClose={() => setContextModalVisible(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Typography variant="h6">Retrieved Context</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontWeight: 400 }}>
            Chunks returned by the knowledge base for this question, with source and relevance score.
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2">Question:</Typography>
              <AdminMarkdown content={selectedQuestion} sx={{ mt: 0.5 }} />
            </Box>
            <Box>
              <Typography variant="subtitle2">Context:</Typography>
              <Paper
                variant="outlined"
                sx={{
                  mt: 0.5,
                  p: 1.5,
                  bgcolor: "action.hover",
                }}
              >
                <AdminMarkdown content={selectedContext} maxHeight={400} />
              </Paper>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setContextModalVisible(false)} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export default DetailedEvaluationPage;
