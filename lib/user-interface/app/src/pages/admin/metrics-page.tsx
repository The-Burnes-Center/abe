import { useState, useEffect, useContext, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Box, IconButton, Skeleton, Stack, Tab, Tabs, Tooltip } from "@mui/material";
import Grid from "@mui/material/Grid2";
import RefreshIcon from "@mui/icons-material/Refresh";
import { ApiClient } from "../../common/api-client/api-client";
import type { FAQInsights, MetricsOverview, UserBreakdown } from "../../common/api-client/metrics-client";
import { AppContext } from "../../common/app-context";
import AdminPageLayout from "../../components/admin-page-layout";
import { useDocumentTitle } from "../../common/hooks/use-document-title";
import {
  FilterState,
  filterStateToApiFilters,
  filtersFromSearchParams,
  filtersToSearchParams,
  formatRangeLabel,
  previousPeriodFilters,
} from "./metrics/filters";
import FilterBar from "./metrics/filter-bar";
import OverviewTab from "./metrics/overview-tab";
import FAQTab from "./metrics/faq-tab";
import UsersTab from "./metrics/users-tab";
import TimeOfDayTab from "./metrics/time-of-day-tab";
import LoadErrorPanel from "./metrics/load-error-panel";

const LOAD_ERROR_FALLBACK = "Failed to load metrics";
const TAB_LABELS = ["Overview", "FAQ Insights", "By User", "Time of Day"];

function LoadingSkeleton() {
  return (
    <Stack spacing={2} aria-busy="true" aria-label="Loading analytics">
      <Grid container spacing={2}>
        {[1, 2, 3, 4].map((i) => (
          <Grid key={i} size={{ xs: 12, sm: 6, md: 3 }}>
            <Skeleton variant="rounded" height={100} />
          </Grid>
        ))}
      </Grid>
      <Skeleton variant="rounded" height={350} />
    </Stack>
  );
}

export default function MetricsPage() {
  useDocumentTitle("Admin · Metrics");
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<FilterState>(() => filtersFromSearchParams(searchParams));

  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<MetricsOverview | null>(null);
  const [faqData, setFaqData] = useState<FAQInsights | null>(null);
  const [userData, setUserData] = useState<UserBreakdown | null>(null);
  const [priorMetrics, setPriorMetrics] = useState<MetricsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tabIndex, setTabIndex] = useState(0);
  const appContext = useContext(AppContext);
  const apiClient = useMemo(() => new ApiClient(appContext!), [appContext]);

  // Keep the URL in step with the filters so a filtered view can be shared or reloaded.
  const updateFilters = useCallback(
    (next: FilterState) => {
      setFilters(next);
      setSearchParams(filtersToSearchParams(next), { replace: true });
    },
    [setSearchParams]
  );

  const rangeValid = filters.from <= filters.to;
  const rangeLabel = formatRangeLabel(filters.from, filters.to);

  const loadAllData = useCallback(async () => {
    if (!rangeValid) return;
    try {
      setLoading(true);
      setError(null);
      const apiFilters = filterStateToApiFilters(filters);
      // FAQ and user breakdowns are secondary: their tabs show an empty state if they fail.
      const [metricsRes, faqRes, userRes] = await Promise.all([
        apiClient.metrics.getMetrics(apiFilters),
        apiClient.metrics.getFAQInsights(apiFilters).catch(() => null),
        apiClient.metrics.getUserBreakdown(apiFilters).catch(() => null),
      ]);
      setMetrics(metricsRes);
      setFaqData(faqRes);
      setUserData(userRes);

      const priorRes = filters.compare
        ? await apiClient.metrics.getMetrics(previousPeriodFilters(filters)).catch(() => null)
        : null;
      setPriorMetrics(priorRes);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : LOAD_ERROR_FALLBACK);
    } finally {
      setLoading(false);
    }
  }, [apiClient, filters, rangeValid]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const renderContent = () => {
    if (loading) return <LoadingSkeleton />;
    if (error) return <LoadErrorPanel message={error} onRetry={loadAllData} retrying={loading} />;
    return (
      <>
        <Tabs
          value={tabIndex}
          onChange={(_, v) => setTabIndex(v)}
          aria-label="Metrics sections"
          sx={{ borderBottom: 1, borderColor: "divider" }}
          variant="scrollable"
          scrollButtons="auto"
        >
          {TAB_LABELS.map((label, i) => (
            <Tab key={label} label={label} id={`metrics-tab-${i}`} aria-controls={`metrics-tabpanel-${i}`} />
          ))}
        </Tabs>
        <Box role="tabpanel" id={`metrics-tabpanel-${tabIndex}`} aria-labelledby={`metrics-tab-${tabIndex}`}>
          {tabIndex === 0 && metrics && <OverviewTab metrics={metrics} prior={priorMetrics} rangeLabel={rangeLabel} />}
          {tabIndex === 1 && <FAQTab faqData={faqData} rangeLabel={rangeLabel} />}
          {tabIndex === 2 && <UsersTab userData={userData} rangeLabel={rangeLabel} />}
          {tabIndex === 3 && metrics && <TimeOfDayTab metrics={metrics} />}
        </Box>
      </>
    );
  };

  return (
    <AdminPageLayout
      title="Analytics"
      description="Usage metrics and FAQ insights for the chatbot."
      breadcrumbLabel="Analytics"
      actions={
        <Tooltip title="Refresh data">
          <span>
            <IconButton onClick={loadAllData} disabled={loading || !rangeValid} aria-label="Refresh analytics">
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
      }
    >
      <FilterBar state={filters} onChange={updateFilters} />

      {!rangeValid && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          The "From" date must be on or before the "To" date.
        </Alert>
      )}

      {renderContent()}
    </AdminPageLayout>
  );
}
