import { Utils } from "../utils";
import { AppConfig } from "../types";
import { FeedbackSubmission } from "../../components/chatbot/types";
import type {
  ActivityLogEntry,
  FeedbackDetail,
  FeedbackItem,
  MonitoringData,
  PromptData,
  PromptItem,
} from "../../pages/admin/feedback-ops/types";

/** Error codes the backend uses that are not meaningful to show to people. */
const OPAQUE_ERROR_CODES = new Set(["internal_error"]);
const GENERIC_ERROR = "Something went wrong. Please try again.";

function errorMessageFrom(body: unknown): string {
  if (typeof body === "string" && body.trim()) return body;
  if (body && typeof body === "object") {
    const { message, error } = body as { message?: unknown; error?: unknown };
    if (typeof message === "string" && message) return message;
    if (typeof error === "string" && error && !OPAQUE_ERROR_CODES.has(error)) return error;
  }
  return GENERIC_ERROR;
}

export class UserFeedbackClient {
  private readonly API;

  constructor(protected _appConfig: AppConfig) {
    this.API = _appConfig.httpEndpoint.slice(0, -1);
  }

  /** Fetch JSON; non-OK responses throw with the server's message. */
  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const auth = await Utils.authenticate();
    const response = await fetch(this.API + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
        ...(init.headers || {}),
      },
    });

    let body: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!response.ok) {
      throw new Error(errorMessageFrom(body));
    }

    return body as T;
  }

  async submitFeedback(payload: FeedbackSubmission) {
    return this.request("/feedback", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async appendFeedbackFollowUp(feedbackId: string, payload: Partial<FeedbackSubmission>) {
    return this.request(`/feedback/${feedbackId}/follow-up`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getAdminFeedback(filters: Record<string, string | undefined> = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      }
    });
    return this.request<{ items?: FeedbackItem[] }>(`/admin/feedback${params.toString() ? `?${params.toString()}` : ""}`, {
      method: "GET",
    });
  }

  async getAdminFeedbackDetail(feedbackId: string) {
    return this.request<FeedbackDetail>(`/admin/feedback/${feedbackId}`, { method: "GET" });
  }

  async analyzeFeedback(feedbackId: string) {
    return this.request(`/admin/feedback/${feedbackId}/analyze`, { method: "POST" });
  }

  async setFeedbackDisposition(
    feedbackId: string,
    payload: {
      reviewStatus: string;
      disposition: string;
      owner?: string;
      resolutionNote?: string;
      adminNotes?: string;
    }
  ) {
    return this.request(`/admin/feedback/${feedbackId}/disposition`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async promoteToCandidate(feedbackId: string) {
    return this.request(`/admin/feedback/${feedbackId}/promote-to-candidate`, {
      method: "POST",
    });
  }

  async deleteFeedback(feedbackId: string) {
    return this.request(`/admin/feedback/${feedbackId}`, {
      method: "DELETE",
    });
  }

  async getPrompts() {
    return this.request<PromptData>("/admin/prompts", { method: "GET" });
  }

  async getPrompt(versionId: string) {
    return this.request<{ prompt: PromptItem }>(`/admin/prompts/${versionId}`, { method: "GET" });
  }

  async createPrompt(payload: {
    title: string;
    notes?: string;
    template?: string;
    parentVersionId?: string;
    linkedFeedbackIds?: string[];
    aiSummary?: string;
  }) {
    return this.request<{ prompt: PromptItem }>("/admin/prompts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updatePrompt(
    versionId: string,
    payload: {
      title?: string;
      notes?: string;
      template?: string;
      linkedFeedbackIds?: string[];
    }
  ) {
    return this.request(`/admin/prompts/${versionId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async deletePrompt(versionId: string) {
    return this.request(`/admin/prompts/${versionId}`, { method: "DELETE" });
  }

  async publishPrompt(versionId: string) {
    return this.request(`/admin/prompts/${versionId}/publish`, {
      method: "POST",
    });
  }

  async aiSuggestPrompt(versionId: string, payload: { feedbackIds?: string[]; note?: string }) {
    return this.request<{ prompt: PromptItem }>(`/admin/prompts/${versionId}/ai-suggest`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getMonitoring() {
    return this.request<MonitoringData>("/admin/monitoring", { method: "GET" });
  }

  async getActivityLog() {
    return this.request<{ entries?: ActivityLogEntry[] }>("/admin/activity-log", { method: "GET" });
  }
}
