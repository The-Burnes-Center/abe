import { Utils } from "../utils";
import { AppConfig } from "../types";

/** DynamoDB LastEvaluatedKey, passed back verbatim to fetch the next page. */
export type PageToken = Record<string, unknown>;

export interface Page<T> {
  Items: T[];
  NextPageToken: PageToken | null;
}

/**
 * One row of EvaluationSummariesTable. Metric fields (`average_similarity`,
 * `average_relevance`, `average_correctness`, `average_context_precision`,
 * `average_context_recall`, `average_response_relevancy`,
 * `average_faithfulness`) are optional: any may be absent, so read them with
 * the helpers in pages/admin/eval-metrics.ts.
 */
export interface EvaluationSummary {
  EvaluationId: string;
  Timestamp: string;
  evaluation_name?: string;
  status?: string;
  executionArn?: string;
  total_questions?: number;
  test_cases_key?: string;
  [field: string]: unknown;
}

/**
 * One row of EvaluationResultsTable. Per-question metric fields
 * (`similarity`, `relevance`, `correctness`, `context_precision`,
 * `context_recall`, `response_relevancy`, `faithfulness`) are optional.
 */
export interface EvaluationResult {
  EvaluationId: string;
  QuestionId: string;
  question_id?: string;
  question?: string;
  expected_response?: string;
  actual_response?: string;
  retrieved_context?: string;
  evaluation_name?: string;
  [field: string]: unknown;
}

export interface EvalStep {
  name: string;
  status: string;
  chunksCompleted?: number;
  chunksTotal?: number;
}

export interface EvalStatus {
  evaluationId: string;
  status: string;
  steps?: EvalStep[];
  elapsedSeconds?: number;
  message?: string;
}

export interface TestCaseFile {
  Key: string;
  LastModified?: string;
  Size?: number;
}

export interface TestCase {
  question: string;
  expectedResponse: string;
}

export interface TestLibraryVersion {
  expectedResponse: string;
  source?: string;
  updatedAt?: string;
}

export interface TestLibraryItem extends TestCase {
  QuestionId: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  versionCount?: number;
  versions?: TestLibraryVersion[];
}

export interface TestLibraryStats {
  total: number;
  sources: Record<string, number>;
}

export interface BulkImportResult {
  added: number;
  updated: number;
  unchanged: number;
}

const EMPTY_PAGE = { Items: [], NextPageToken: null };

/** DynamoDB says the table doesn't exist yet: a fresh deploy with no runs. */
const MISSING_TABLE_MARKER = "ResourceNotFoundException";

function asPage<T>(result: unknown): Page<T> {
  const page = result as Partial<Page<T>> | null;
  if (!page || !Array.isArray(page.Items)) return { ...EMPTY_PAGE };
  return { Items: page.Items, NextPageToken: page.NextPageToken ?? null };
}

export class EvaluationsClient {
  private readonly API;
  constructor(protected _appConfig: AppConfig) {
    this.API = _appConfig.httpEndpoint.slice(0, -1);
  }

  /** POST JSON and return the parsed body; non-OK responses throw the server's message. */
  private async post<T>(path: string, body: unknown, fallback: string): Promise<T> {
    const auth = await Utils.authenticate();
    const response = await fetch(`${this.API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(await Utils.extractServerError(response, fallback));
    }
    return response.json() as Promise<T>;
  }

  async getEvaluationSummaries(
    continuationToken?: PageToken | null,
    limit: number = 10
  ): Promise<Page<EvaluationSummary>> {
    const auth = await Utils.authenticate();
    const body: Record<string, unknown> = { operation: "get_evaluation_summaries", limit };
    if (continuationToken) body.continuation_token = continuationToken;

    const response = await fetch(`${this.API}/eval-results-handler`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body),
    });

    if (response.status === 404) return { ...EMPTY_PAGE };
    if (!response.ok) {
      // Only a missing table means "no evaluations yet". Anything else
      // (including ValidationException, e.g. a malformed page token) is a
      // real failure the caller should show.
      const raw = await response.clone().text().catch(() => "");
      if (raw.includes(MISSING_TABLE_MARKER)) return { ...EMPTY_PAGE };
      throw new Error(
        await Utils.extractServerError(response, "Failed to load evaluation summaries")
      );
    }
    return asPage<EvaluationSummary>(await response.json());
  }

  async getEvaluationResults(
    evaluationId: string,
    continuationToken?: PageToken | null,
    limit: number = 10
  ): Promise<Page<EvaluationResult>> {
    const body: Record<string, unknown> = {
      operation: "get_evaluation_results",
      evaluation_id: evaluationId,
      limit,
    };
    if (continuationToken) body.continuation_token = continuationToken;
    const result = await this.post<unknown>(
      "/eval-results-handler",
      body,
      "Failed to load evaluation results"
    );
    return asPage<EvaluationResult>(result);
  }

  async startNewEvaluation(
    evaluationName: string,
    testCaseFile?: string,
    testCasesInline?: TestCase[]
  ): Promise<{ evaluationId: string }> {
    const body: Record<string, unknown> = { evaluation_name: evaluationName };
    if (testCaseFile) body.testCasesKey = testCaseFile;
    if (testCasesInline) body.testCasesInline = testCasesInline;
    return this.post("/eval-run-handler", body, "Failed to start evaluation");
  }

  async getEvalStatus(evaluationId: string): Promise<EvalStatus> {
    return this.post(
      "/eval-results-handler",
      { operation: "get_eval_status", evaluation_id: evaluationId },
      "Failed to get evaluation status"
    );
  }

  async deleteEvaluation(evaluationId: string): Promise<unknown> {
    return this.post(
      "/eval-results-handler",
      { operation: "delete_evaluation", evaluation_id: evaluationId },
      "Failed to delete evaluation"
    );
  }

  async getUploadURL(fileName: string, fileType: string): Promise<string> {
    if (!fileType) throw new Error("Must have valid file type!");
    // The backend names the specific problem (e.g. which character in the
    // filename was rejected); post() surfaces it.
    const data = await this.post<{ signedUrl: string }>(
      "/signed-url-test-cases",
      { fileName, fileType },
      "Failed to get upload URL."
    );
    return data.signedUrl;
  }

  async getDocuments(
    continuationToken?: string,
    pageIndex?: number
  ): Promise<{ Contents?: TestCaseFile[] }> {
    return this.post(
      "/s3-test-cases-bucket-data",
      { continuationToken, pageIndex },
      "Failed to get files"
    );
  }

  // --- Test Library ---
  async listTestLibrary(
    search?: string,
    continuationToken?: PageToken | null,
    limit = 25
  ): Promise<Page<TestLibraryItem>> {
    const result = await this.post<unknown>(
      "/test-library",
      { operation: "list", search, continuation_token: continuationToken, limit },
      "Failed to list test library"
    );
    return asPage<TestLibraryItem>(result);
  }

  async getTestLibraryItem(questionId: string): Promise<TestLibraryItem> {
    return this.post(
      "/test-library",
      { operation: "get", question_id: questionId },
      "Failed to get test library item"
    );
  }

  async createTestLibraryItem(
    question: string,
    expectedResponse: string
  ): Promise<{ action: string; questionId?: string }> {
    return this.post(
      "/test-library",
      { operation: "create", question, expectedResponse },
      "Failed to create test library item"
    );
  }

  async updateTestLibraryItem(questionId: string, expectedResponse: string): Promise<{ action: string }> {
    return this.post(
      "/test-library",
      { operation: "update", question_id: questionId, expectedResponse },
      "Failed to update test library item"
    );
  }

  async revertTestLibraryItem(questionId: string, versionIndex: number): Promise<{ action: string }> {
    return this.post(
      "/test-library",
      { operation: "revert", question_id: questionId, version_index: versionIndex },
      "Failed to revert test library item"
    );
  }

  async deleteTestLibraryItem(questionId: string): Promise<{ action: string }> {
    return this.post(
      "/test-library",
      { operation: "delete", question_id: questionId },
      "Failed to delete test library item"
    );
  }

  async bulkImportTestLibrary(items: TestCase[], source = "import"): Promise<BulkImportResult> {
    return this.post(
      "/test-library",
      { operation: "bulk_import", items, source },
      "Failed to bulk import"
    );
  }

  async exportTestLibrary(): Promise<{ items: TestCase[]; count: number }> {
    return this.post("/test-library", { operation: "export" }, "Failed to export test library");
  }

  async getTestLibraryStats(): Promise<TestLibraryStats> {
    return this.post("/test-library", { operation: "stats" }, "Failed to get test library stats");
  }
}
