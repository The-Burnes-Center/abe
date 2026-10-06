/**
 * @module prompt-registry
 *
 * Versioned prompt management with a DynamoDB-backed registry.
 *
 * ## Purpose
 * Allows the system prompt to be edited by admins through the UI without
 * redeploying. The code-embedded prompt (in prompt.mjs) is treated as the
 * "system-default" version. Admins can create custom versions in DynamoDB;
 * a special LIVE pointer row determines which version is actually served.
 *
 * ## LIVE pointer indirection
 * The registry uses a two-level lookup:
 *   1. Read the LIVE row (`VersionId = "LIVE"`) for the prompt family.
 *      Its `ActiveVersionId` field names the version that should be used.
 *   2. Fetch that version row to get the actual template text.
 *
 * This indirection lets admins switch the active prompt atomically (update
 * one DynamoDB item) without touching the version rows themselves.
 *
 * ## SHA-256 hash-based change detection
 * Each version row stores a `TemplateHash` (SHA-256 of the template text).
 * On every cold/warm start, `ensureSystemDefault` compares the hash of the
 * code-embedded prompt against the stored hash. If they differ (i.e. a new
 * deployment changed the prompt), the system-default row is overwritten and
 * the LIVE pointer is updated -- but only when no admin-created version is
 * active (see "custom version preservation" below). A module-level cache
 * (`_cachedHash`) skips the DynamoDB read entirely when the hash has not
 * changed within the same Lambda execution context.
 *
 * ## Fallback chain
 *   Registry LIVE pointer -> referenced version row -> embedded default
 * If `PROMPT_REGISTRY_TABLE` is not set, or if the LIVE pointer / version
 * row is missing, the module falls back to the code-embedded default
 * template so the chatbot always has a working system prompt.
 *
 * ## Custom version preservation
 * When the LIVE pointer references a version whose `CreatedBy` is NOT
 * "system", the pointer is left untouched during `ensureSystemDefault`.
 * This prevents a routine deployment from overriding an admin's deliberate
 * prompt edit. Only system-created versions are auto-promoted.
 */

import { createHash } from "crypto";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { logger } from "./logger.mjs";

/** Well-known VersionId for the code-embedded default prompt row. */
const SYSTEM_DEFAULT_VERSION_ID = "system-default";

const ddbClient = new DynamoDBClient({});

/**
 * Module-level in-memory cache of the last-written template hash.
 * Prevents redundant DynamoDB reads within a single Lambda execution
 * context when the code-embedded prompt has not changed.
 * @type {string|null}
 */
let _cachedHash = null;

/**
 * Wrap the raw base prompt with the standard variable placeholders.
 *
 * Appends a `{{current_date}}` section so {@link renderPromptTemplate} can
 * inject the runtime date later. The document inventory is intentionally NOT
 * inlined here — the model retrieves it on demand via the `fetch_metadata`
 * tool, which keeps the system prompt small and stays accurate when the KB
 * changes mid-session.
 *
 * @param {string} basePrompt - The raw system prompt exported by prompt.mjs.
 * @returns {string} Template string containing mustache-style placeholders.
 */
function buildDefaultPromptTemplate(basePrompt) {
  return `${basePrompt}

### Current Date
Today is {{current_date}}. Use this to evaluate the recency and relevance of information in the retrieved documents.`;
}

/**
 * Replace mustache-style placeholders in a prompt template with runtime values.
 *
 * @param {string} template - Template containing the `{{current_date}}` placeholder.
 * @param {object} params
 * @param {string} params.currentDate - Human-readable date string.
 * @returns {string} Fully rendered prompt text ready for Bedrock.
 */
function renderPromptTemplate(template, { currentDate }) {
  return template
    .replaceAll("{{current_date}}", currentDate)
    .replaceAll("{{assistant_name}}", process.env.ASSISTANT_NAME || "Assistant")
    .replaceAll("{{organization}}", process.env.ORGANIZATION_NAME || process.env.ORGANIZATION || "our organization")
    .replaceAll("{{support_contact}}", process.env.SUPPORT_CONTACT || "your administrator")
    .replaceAll("{{domain_context}}", process.env.DOMAIN_CONTEXT || "");
}

/**
 * Compute a SHA-256 hex digest of a template string.
 * Used for change detection between code-embedded and stored versions.
 *
 * @param {string} template
 * @returns {string} 64-character lowercase hex hash.
 */
function hashTemplate(template) {
  return createHash("sha256").update(template).digest("hex");
}

/**
 * Fetch a single prompt version row from DynamoDB.
 *
 * @param {string} promptFamily - Partition key (e.g. "ASSISTANT_CHAT").
 * @param {string} versionId - Sort key identifying the version.
 * @returns {Promise<{versionId: string, template: string, createdBy: string}|null>}
 *   The version record, or null if it does not exist or is not a PromptVersion.
 */
async function getPromptVersion(promptFamily, versionId) {
  const tableName = process.env.PROMPT_REGISTRY_TABLE;
  if (!tableName) return null;

  const response = await ddbClient.send(new GetItemCommand({
    TableName: tableName,
    Key: {
      PromptFamily: { S: promptFamily },
      VersionId: { S: versionId },
    },
  }));

  if (!response.Item || response.Item.ItemType?.S !== "PromptVersion") {
    return null;
  }

  return {
    versionId,
    template: response.Item.Template?.S ?? "",
    createdBy: response.Item.CreatedBy?.S ?? "",
  };
}

/**
 * Upsert the "system-default" version row and conditionally update the
 * LIVE pointer.
 *
 * Called on every prompt load. The function:
 *   1. Builds the default template from the code-embedded base prompt.
 *   2. Hashes it and compares against `_cachedHash` (fast in-memory check).
 *   3. If the hash differs, reads the stored row and compares hashes.
 *   4. On mismatch, writes the new template + hash to the system-default row.
 *   5. Reads the LIVE pointer to decide whether to redirect it:
 *      - If LIVE points to nothing, or to "system-default", update it.
 *      - If LIVE points to another version created by "system", update it.
 *      - If LIVE points to a version created by an admin (createdBy != "system"),
 *        leave it alone -- the admin's choice takes precedence.
 *
 * @param {string} promptFamily - Partition key (e.g. "ASSISTANT_CHAT").
 * @param {string} basePrompt - Raw prompt text from prompt.mjs.
 */
async function ensureSystemDefault(promptFamily, basePrompt) {
  const tableName = process.env.PROMPT_REGISTRY_TABLE;
  if (!tableName) return;

  const template = buildDefaultPromptTemplate(basePrompt);
  const currentHash = hashTemplate(template);

  if (_cachedHash === currentHash) return;

  const existing = await ddbClient.send(new GetItemCommand({
    TableName: tableName,
    Key: {
      PromptFamily: { S: promptFamily },
      VersionId: { S: SYSTEM_DEFAULT_VERSION_ID },
    },
  }));

  const storedHash = existing.Item?.TemplateHash?.S;

  if (storedHash !== currentHash) {
    const now = new Date().toISOString();
    await ddbClient.send(new PutItemCommand({
      TableName: tableName,
      Item: {
        PromptFamily: { S: promptFamily },
        VersionId: { S: SYSTEM_DEFAULT_VERSION_ID },
        ItemType: { S: "PromptVersion" },
        Template: { S: template },
        TemplateHash: { S: currentHash },
        Status: { S: "published" },
        Title: { S: "Code Default" },
        Notes: { S: "Auto-synced from code deployment. Read-only." },
        CreatedAt: { S: existing.Item?.CreatedAt?.S || now },
        UpdatedAt: { S: now },
        PublishedAt: { S: now },
        CreatedBy: { S: "system" },
      },
    }));
    console.log("System-default prompt updated (hash changed).");

    const livePointer = await ddbClient.send(new GetItemCommand({
      TableName: tableName,
      Key: {
        PromptFamily: { S: promptFamily },
        VersionId: { S: "LIVE" },
      },
    }));

    const activeVersionId = livePointer.Item?.ActiveVersionId?.S || livePointer.Item?.Template?.S;
    let shouldUpdateLive = false;

    if (!activeVersionId || activeVersionId === SYSTEM_DEFAULT_VERSION_ID) {
      shouldUpdateLive = true;
    } else {
      const activeVersion = await getPromptVersion(promptFamily, activeVersionId);
      if (!activeVersion || activeVersion.createdBy === "system") {
        shouldUpdateLive = true;
      }
    }

    if (shouldUpdateLive) {
      await ddbClient.send(new PutItemCommand({
        TableName: tableName,
        Item: {
          PromptFamily: { S: promptFamily },
          VersionId: { S: "LIVE" },
          ItemType: { S: "LivePointer" },
          ActiveVersionId: { S: SYSTEM_DEFAULT_VERSION_ID },
          Template: { S: SYSTEM_DEFAULT_VERSION_ID },
          UpdatedAt: { S: now },
        },
      }));
      console.log("LIVE pointer updated to system-default.");
    }
  }

  _cachedHash = currentHash;
}

/**
 * Resolve the currently active prompt template via the LIVE pointer.
 *
 * Implements the full fallback chain:
 *   1. If `PROMPT_REGISTRY_TABLE` is not set, return the embedded default.
 *   2. Call {@link ensureSystemDefault} to sync the code-embedded prompt
 *      (skipped when `readOnly`).
 *   3. Read the LIVE pointer's `ActiveVersionId`.
 *   4. Fetch the referenced version. If missing, fall back to the default.
 *
 * @param {string} promptFamily - Partition key (e.g. "ASSISTANT_CHAT").
 * @param {string} basePrompt - Raw prompt text from prompt.mjs (used as
 *   fallback and for syncing the system-default row).
 * @param {object} [options]
 * @param {boolean} [options.readOnly=false] - Skip the system-default sync.
 * @returns {Promise<{versionId: string, template: string}>}
 */
async function getLivePrompt(promptFamily, basePrompt, { readOnly = false } = {}) {
  const tableName = process.env.PROMPT_REGISTRY_TABLE;
  if (!tableName) {
    return {
      versionId: "embedded-default",
      template: buildDefaultPromptTemplate(basePrompt),
    };
  }

  if (!readOnly) {
    await ensureSystemDefault(promptFamily, basePrompt);
  }

  const livePointer = await ddbClient.send(new GetItemCommand({
    TableName: tableName,
    Key: {
      PromptFamily: { S: promptFamily },
      VersionId: { S: "LIVE" },
    },
  }));

  const activeVersionId = livePointer.Item?.ActiveVersionId?.S || livePointer.Item?.Template?.S;
  if (!activeVersionId) {
    return {
      versionId: SYSTEM_DEFAULT_VERSION_ID,
      template: buildDefaultPromptTemplate(basePrompt),
    };
  }

  const version = await getPromptVersion(promptFamily, activeVersionId);
  // A read-only caller can't run the system-default sync, so a system-owned
  // row may predate this deployment. Chat would have replaced it with the
  // code default on its next request, so serve that instead.
  if (!version || (readOnly && version.createdBy === "system")) {
    return {
      versionId: SYSTEM_DEFAULT_VERSION_ID,
      template: buildDefaultPromptTemplate(basePrompt),
    };
  }

  return version;
}

/**
 * Public entry point: load, render, and return the active system prompt.
 *
 * Orchestrates the full pipeline:
 *   1. Resolve the live prompt template from the registry (or fallback).
 *   2. Render placeholders (`{{current_date}}`, brand values).
 *   3. Return the final text plus version metadata for logging/tracing.
 *
 * A registry failure (throttling, missing table permissions, a bad row)
 * never fails the chat: it is logged at error level and the embedded
 * default prompt is served instead.
 *
 * @param {string} basePrompt - Raw prompt from prompt.mjs.
 * @param {string} currentDate - Human-readable date string.
 * @param {object} [options]
 * @param {boolean} [options.readOnly=false] - Never write to the registry
 *   (skip the system-default sync). Used by the evaluation Lambda, which
 *   shares the chat prompt family and must not change what chat serves.
 * @returns {Promise<{promptVersionId: string, promptTemplateHash: string, promptText: string}>}
 *   `promptVersionId` identifies which version was served (useful for
 *   evaluation tracing). `promptTemplateHash` enables downstream
 *   cache-invalidation checks. `promptText` is the fully rendered string
 *   passed to Bedrock as the system message.
 */
export async function loadRenderedPrompt(basePrompt, currentDate, { readOnly = false } = {}) {
  const promptFamily = process.env.PROMPT_FAMILY || "ASSISTANT_CHAT";
  let livePrompt;
  try {
    livePrompt = await getLivePrompt(promptFamily, basePrompt, { readOnly });
  } catch (err) {
    logger.error("Prompt registry read failed; serving the embedded default prompt", {
      promptFamily,
      error: err?.message,
      name: err?.name,
    });
    livePrompt = {
      versionId: "embedded-default",
      template: buildDefaultPromptTemplate(basePrompt),
    };
  }
  const promptText = renderPromptTemplate(livePrompt.template, { currentDate });

  return {
    promptVersionId: livePrompt.versionId,
    promptTemplateHash: hashTemplate(livePrompt.template),
    promptText,
  };
}
