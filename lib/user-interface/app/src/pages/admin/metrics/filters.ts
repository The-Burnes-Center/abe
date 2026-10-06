import type { MetricsFilters } from "../../../common/api-client/metrics-client";

// ---------- Date / filter helpers ----------

export type PresetKey = "7d" | "30d" | "90d" | "6mo" | "12mo" | "custom";

export const PRESETS: Array<{ key: PresetKey; label: string; days?: number }> = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "6mo", label: "Last 6 months", days: 182 },
  { key: "12mo", label: "Last 12 months", days: 365 },
  { key: "custom", label: "Custom" },
];

const MS_PER_DAY = 86400000;
const DEFAULT_PRESET_DAYS = 30;

export interface FilterState {
  preset: PresetKey;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  compare: boolean;
}

export function todayISO(): string {
  // Use local-time date components (admins are usually in the deployment time zone; the small
  // drift for anyone elsewhere is acceptable for the picker default, the server normalizes anyway).
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDaysISO(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime();
  const b = new Date(`${toISO}T00:00:00`).getTime();
  return Math.round((b - a) / MS_PER_DAY) + 1;
}

export function formatRangeLabel(fromISO: string, toISO: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${fmt.format(new Date(`${fromISO}T00:00:00`))} – ${fmt.format(new Date(`${toISO}T00:00:00`))}`;
}

export function defaultFilters(): FilterState {
  const to = todayISO();
  const from = addDaysISO(to, -(DEFAULT_PRESET_DAYS - 1));
  return { preset: "30d", from, to, compare: false };
}

export function presetToRange(
  key: PresetKey,
  currentFrom: string,
  currentTo: string
): { from: string; to: string } {
  const preset = PRESETS.find((p) => p.key === key);
  if (!preset || !preset.days) return { from: currentFrom, to: currentTo };
  const to = todayISO();
  const from = addDaysISO(to, -(preset.days - 1));
  return { from, to };
}

export function filtersFromSearchParams(params: URLSearchParams): FilterState {
  const base = defaultFilters();
  const preset = (params.get("preset") as PresetKey) || base.preset;
  const fromParam = params.get("from");
  const toParam = params.get("to");
  const compare = params.get("compare") === "1";

  if (preset === "custom" && fromParam && toParam) {
    return { preset, from: fromParam, to: toParam, compare };
  }
  const { from, to } = presetToRange(preset, base.from, base.to);
  return { preset, from, to, compare };
}

export function filtersToSearchParams(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("preset", state.preset);
  if (state.preset === "custom") {
    params.set("from", state.from);
    params.set("to", state.to);
  }
  if (state.compare) params.set("compare", "1");
  return params;
}

export function filterStateToApiFilters(state: FilterState): MetricsFilters {
  return { from: state.from, to: state.to };
}

export function previousPeriodFilters(state: FilterState): MetricsFilters {
  const span = daysBetween(state.from, state.to);
  const to = addDaysISO(state.from, -1);
  const from = addDaysISO(to, -(span - 1));
  return { from, to };
}
