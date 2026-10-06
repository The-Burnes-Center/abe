import { Utils } from "../utils";
import { AppConfig } from "../types";

function devLog(...args: unknown[]) {
  if (import.meta.env.DEV) console.log(...args);
}

const DEFAULT_LOOKBACK_DAYS = 30;

/** Range echoed back by GET /metrics so the UI can label what it is showing. */
export interface RangeMeta {
  from: string;
  to: string;
  days: number;
  hour_from: number | null;
  hour_to: number | null;
  timezone: string;
}

export interface DailyUser {
  user_id: string;
  display_name: string;
  sessions: number;
  messages: number;
}

export interface DailyBreakdownRow {
  date: string;
  sessions: number;
  messages: number;
  unique_users: number;
  users?: DailyUser[];
}

export interface HourlyBucket {
  hour: string;
  sessions: number;
}

/** GET /metrics (no type): headline KPIs plus daily and hourly series. */
export interface MetricsOverview {
  unique_users: number;
  total_sessions: number;
  total_messages: number;
  avg_messages_per_session: number;
  peak_hour: string;
  hourly_distribution?: HourlyBucket[];
  /** 24 rows x 7 cols (Mon..Sun), bucketed server-side in the deployment time zone. */
  hour_by_weekday?: number[][];
  daily_breakdown: DailyBreakdownRow[];
  timezone?: string;
  range?: RangeMeta;
}

export interface FAQSample {
  question: string;
  display_name?: string;
}

export interface FAQTopic {
  topic: string;
  count: number;
  sample_questions: FAQSample[];
}

/** GET /metrics?type=faq */
export interface FAQInsights {
  topics: FAQTopic[];
  total_classified: number;
  range?: RangeMeta;
}

export interface TopicCount {
  topic: string;
  count: number;
}

export interface UserRecentQuestion {
  question: string;
  topic: string;
  timestamp: string;
}

export interface UserBreakdownRow {
  user_id: string;
  display_name: string;
  messages: number;
  top_topics: TopicCount[];
  recent_questions: UserRecentQuestion[];
}

/** GET /metrics?type=by_user */
export interface UserBreakdown {
  users: UserBreakdownRow[];
  total_messages: number;
  range?: RangeMeta;
}

/** GET /metrics?type=traffic */
export interface TrafficDetails {
  daily_breakdown: DailyBreakdownRow[];
  hourly_distribution: HourlyBucket[];
  hour_by_weekday: number[][];
  avg_messages_per_session: number;
  peak_hour: string;
  timezone?: string;
  range?: RangeMeta;
}

export interface MetricsFilters {
  /** ISO date YYYY-MM-DD in the deployment time zone. Takes precedence over `days`. */
  from?: string;
  /** ISO date YYYY-MM-DD in the deployment time zone. Takes precedence over `days`. */
  to?: string;
  /** Trailing-N-days lookback (fallback when from/to omitted). */
  days?: number;
  /** Hour-of-day window in the deployment time zone, inclusive. 0-23. */
  hourFrom?: number;
  hourTo?: number;
}

type MetricType = "" | "faq" | "by_user" | "traffic";

/** Admin analytics client for the GET /metrics endpoint. */
export class MetricClient {
  private readonly API: string;
  constructor(protected _appConfig: AppConfig) {
    this.API = _appConfig.httpEndpoint.slice(0, -1);
  }

  private buildMetricsParams(type: MetricType, filters?: MetricsFilters): URLSearchParams {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (filters?.from) params.set("from", filters.from);
    if (filters?.to) params.set("to", filters.to);
    if (filters?.from === undefined && filters?.to === undefined) {
      params.set("days", String(filters?.days ?? DEFAULT_LOOKBACK_DAYS));
    }
    if (typeof filters?.hourFrom === "number") params.set("hour_from", String(filters.hourFrom));
    if (typeof filters?.hourTo === "number") params.set("hour_to", String(filters.hourTo));
    return params;
  }

  private async fetchMetrics<T>(type: MetricType, filters?: MetricsFilters): Promise<T> {
    const auth = await Utils.authenticate();
    const qs = this.buildMetricsParams(type, filters).toString();
    const url = qs ? `${this.API}/metrics?${qs}` : `${this.API}/metrics`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
      },
    });
    if (!response.ok) {
      const fallback = `Failed to load ${type || "overview"} metrics`;
      const message = await Utils.extractServerError(response, fallback);
      devLog("Metrics request failed:", response.status, message);
      throw new Error(message);
    }
    return (await response.json()) as T;
  }

  async getMetrics(filters?: MetricsFilters): Promise<MetricsOverview> {
    return this.fetchMetrics<MetricsOverview>("", filters);
  }

  async getFAQInsights(filters?: MetricsFilters | number): Promise<FAQInsights> {
    return this.fetchMetrics<FAQInsights>("faq", normalizeFilters(filters));
  }

  async getUserBreakdown(filters?: MetricsFilters | number): Promise<UserBreakdown> {
    return this.fetchMetrics<UserBreakdown>("by_user", normalizeFilters(filters));
  }

  async getTrafficDetails(filters?: MetricsFilters | number): Promise<TrafficDetails> {
    return this.fetchMetrics<TrafficDetails>("traffic", normalizeFilters(filters));
  }
}

function normalizeFilters(input?: MetricsFilters | number): MetricsFilters | undefined {
  if (input === undefined) return undefined;
  if (typeof input === "number") return { days: input };
  return input;
}
