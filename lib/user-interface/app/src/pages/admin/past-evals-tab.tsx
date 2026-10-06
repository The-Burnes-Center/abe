import {
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  Box,
  Stack,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  TableSortLabel,
  Paper,
  Button,
  Typography,
  Chip,
  Tooltip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Utils } from "../../common/utils";
import { AppContext } from "../../common/app-context";
import { ApiClient } from "../../common/api-client/api-client";
import { ColumnItem, getColumnDefinition } from "./columns";
import { hasAnyScore, serverTimestampMs } from "./eval-metrics";
import type {
  EvaluationSummary,
  Page,
  PageToken,
} from "../../common/api-client/evaluations-client";
import { useNavigate } from "react-router-dom";

const TERMINAL_FAILURE_STATUSES = ["FAILED", "TIMED_OUT", "ABORTED"];

/**
 * A run can have two summary rows (a RUNNING placeholder and the finished
 * record). Keep one per EvaluationId, preferring the one with scores, then
 * the newest, and carry over whichever executionArn is known.
 */
function dedupeSummaries(items: EvaluationSummary[]): EvaluationSummary[] {
  const byId = new Map<string, EvaluationSummary>();
  for (const item of items) {
    const id = item.EvaluationId;
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, item);
      continue;
    }
    const itemScored = hasAnyScore(item);
    const existingScored = hasAnyScore(existing);
    const preferItem =
      itemScored !== existingScored
        ? itemScored
        : serverTimestampMs(item.Timestamp) > serverTimestampMs(existing.Timestamp);
    const [winner, loser] = preferItem ? [item, existing] : [existing, item];
    byId.set(id, { ...winner, executionArn: winner.executionArn || loser.executionArn });
  }
  return Array.from(byId.values());
}

export default function PastEvalsTab() {
  const appContext = useContext(AppContext);
  const apiClient = useMemo(() => new ApiClient(appContext!), [appContext]);
  const [loading, setLoading] = useState(true);
  const [currentPageIndex, setCurrentPageIndex] = useState(1);
  const [pages, setPages] = useState<Page<EvaluationSummary>[]>([]);
  const needsRefresh = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [deleteTarget, setDeleteTarget] = useState<ColumnItem | null>(null);
  const [deleteInProgress, setDeleteInProgress] = useState(false);

  const onProblemClick = useCallback(
    (evaluationItem: ColumnItem) => {
      const evaluationId = evaluationItem.EvaluationId || evaluationItem.evaluationId;
      if (typeof evaluationId === "string" && evaluationId) {
        navigate(`/admin/llm-evaluation/details/${evaluationId}`);
      }
    },
    [navigate]
  );

  const onRequestDeleteEvaluation = useCallback((item: ColumnItem) => {
    setDeleteTarget(item);
  }, []);

  const columnDefinitions = useMemo(
    () =>
      getColumnDefinition("evaluationSummary", onProblemClick, {
        onDeleteEvaluation: onRequestDeleteEvaluation,
      }),
    [onProblemClick, onRequestDeleteEvaluation]
  );

  const currentPageItems = useMemo<EvaluationSummary[]>(
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
    if (!col) return currentPageItems;
    const sorted = col.sortingComparator
      ? [...currentPageItems].sort(col.sortingComparator)
      : [...currentPageItems].sort((a, b) => {
          const aVal = String(a[sortField] ?? "");
          const bVal = String(b[sortField] ?? "");
          return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        });
    return sortDirection === "desc" ? sorted.reverse() : sorted;
  }, [currentPageItems, sortField, sortDirection, columnDefinitions]);

  const getEvaluations = useCallback(
    async (params: { pageIndex?: number; nextPageToken?: PageToken | null }) => {
      setLoading(true);
      try {
        const result = await apiClient.evaluations.getEvaluationSummaries(
          params.nextPageToken
        );

        // Metric fields are left as-is (absent stays absent) so the score
        // cells can show "n/a" instead of a fake 0%.
        const named = result.Items.map((evaluation) => ({
          ...evaluation,
          evaluation_name: evaluation.evaluation_name || "Unnamed",
        }));

        const processedResult: Page<EvaluationSummary> = {
          ...result,
          Items: dedupeSummaries(named),
        };

        setError(null);
        setPages((current) => {
          if (needsRefresh.current) {
            needsRefresh.current = false;
            return [processedResult];
          }
          if (typeof params.pageIndex !== "undefined") {
            const newPages = [...current];
            newPages[params.pageIndex - 1] = processedResult;
            return newPages;
          }
          return [...current, processedResult];
        });
      } catch (error) {
        setError(`Failed to load evaluations: ${Utils.getErrorMessage(error)}`);
        setPages([]);
      } finally {
        setLoading(false);
      }
    },
    [apiClient]
  );

  const confirmDeleteEvaluation = useCallback(async () => {
    const id = deleteTarget?.EvaluationId;
    if (typeof id !== "string" || !id) return;
    setDeleteInProgress(true);
    setError(null);
    try {
      await apiClient.evaluations.deleteEvaluation(id);
      setDeleteTarget(null);
      needsRefresh.current = true;
      setCurrentPageIndex(1);
      await getEvaluations({ pageIndex: 1 });
    } catch (err) {
      setError(`Failed to delete evaluation: ${Utils.getErrorMessage(err)}`);
    } finally {
      setDeleteInProgress(false);
    }
  }, [deleteTarget, apiClient, getEvaluations]);

  useEffect(() => {
    needsRefresh.current = true;
    setCurrentPageIndex(1);
    getEvaluations({ pageIndex: 1 });
  }, [getEvaluations]);

  const onNextPageClick = async () => {
    const token = pages[currentPageIndex - 1]?.NextPageToken;
    if (token) {
      if (pages.length <= currentPageIndex) {
        await getEvaluations({ nextPageToken: token });
      }
      setCurrentPageIndex((c) => Math.min(pages.length + 1, c + 1));
    }
  };

  return (
    <Stack spacing={2}>
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => !deleteInProgress && setDeleteTarget(null)}
        aria-labelledby="delete-eval-dialog-title"
      >
        <DialogTitle id="delete-eval-dialog-title">Delete this evaluation?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This removes the run from history and deletes stored results. If the evaluation is still running or stuck,
            its Step Functions execution will be stopped. This cannot be undone.
          </Typography>
          {deleteTarget ? (
            <Typography variant="body2" sx={{ mt: 1, fontWeight: 600 }}>
              {String(deleteTarget.evaluation_name || "Unnamed")} ({String(deleteTarget.EvaluationId)})
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteInProgress}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void confirmDeleteEvaluation()}
            disabled={deleteInProgress}
          >
            {deleteInProgress ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h6" component="h2">Evaluation History</Typography>
        <IconButton onClick={() => getEvaluations({ pageIndex: currentPageIndex })} aria-label="Refresh evaluations">
          <RefreshIcon />
        </IconButton>
      </Stack>

      {loading ? (
        <Box
          role="status"
          aria-label="Loading evaluation history"
          sx={{ display: "flex", justifyContent: "center", p: 4 }}
        >
          <CircularProgress aria-hidden="true" />
        </Box>
      ) : sortedItems.length === 0 ? (
        <Box sx={{ textAlign: "center", p: 4 }}>
          <Chip
            label={error || "No evaluations found"}
            color={error ? "error" : "warning"}
            variant="outlined"
          />
        </Box>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small" aria-label="Evaluation history">
            <TableHead>
              <TableRow>
                {columnDefinitions.map((col) => {
                  const isSortable = !!col.sortingField && !col.disableSort;
                  const isActiveSort = isSortable && sortField === col.sortingField;
                  return (
                    <TableCell
                      key={col.id}
                      sortDirection={isActiveSort ? sortDirection : false}
                      aria-sort={
                        isSortable
                          ? isActiveSort
                            ? sortDirection === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                          : undefined
                      }
                      sx={{ fontWeight: "bold", ...(col.width ? { width: col.width } : {}) }}
                    >
                      {isSortable ? (
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
              {sortedItems.map((item, index) => {
                const hasScores = hasAnyScore(item);
                const isFailed = TERMINAL_FAILURE_STATUSES.includes(item.status ?? "");
                // A run is only "still running" if it hasn't reached a terminal state.
                // Failed/timed-out/aborted runs are terminal, so they must NOT render as
                // running (otherwise a failed eval shows progress bars forever).
                const isRunning =
                  !hasScores &&
                  !isFailed &&
                  (item.status === "RUNNING" || (item.executionArn && item.status !== "COMPLETED"));
                const isDataCol = (col_id: string) =>
                  col_id !== "evaluationName" &&
                  col_id !== "timestamp" &&
                  col_id !== "viewDetails" &&
                  col_id !== "deleteEval";
                return (
                  <TableRow key={item.EvaluationId || index} hover sx={isRunning || isFailed ? { opacity: 0.7 } : {}}>
                    {columnDefinitions.map((col) => (
                      <TableCell key={col.id}>
                        {isRunning && isDataCol(col.id) ? (
                          <LinearProgress sx={{ width: 60 }} />
                        ) : isFailed && isDataCol(col.id) ? (
                          col.id === "answerQuality" ? (
                            <Tooltip title="This run didn't finish. Delete it and try running it again." arrow>
                              <Chip label="Failed" color="error" size="small" variant="outlined" sx={{ cursor: "help" }} />
                            </Tooltip>
                          ) : (
                            "n/a"
                          )
                        ) : (
                          col.cell(item)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
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
            onClick={onNextPageClick}
          >
            Next
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
