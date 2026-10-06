/**
 * @module persistence
 *
 * Shapes what the chat handler writes to DynamoDB (session history rows and
 * response traces) so items stay small and free of short-lived credentials.
 */

/** Source fields worth keeping once the live response has been delivered. */
const STORED_SOURCE_FIELDS = ["chunkIndex", "title", "s3Key", "page", "excerpt", "score", "sourceType", "cited"];

/** Most sources stored per turn (the UI only lists cited ones anyway). */
export const MAX_STORED_SOURCES = 50;

/**
 * Ceiling for one turn's serialized metadata. A session row holds every turn
 * in a single DynamoDB item (400 KB hard limit), so per-turn metadata must
 * stay a small fraction of that.
 */
export const MAX_STORED_METADATA_CHARS = 30_000;

/**
 * Copy sources without their presigned `uri`.
 *
 * A presigned URL expires after an hour and embeds the Lambda role's
 * temporary session token, so it is useless on reload and must not sit in a
 * table. The frontend re-presigns from `s3Key` via the source-presign API.
 *
 * @param {Array<object>} sources
 * @returns {Array<object>} New source objects with only the stored fields.
 */
export function sanitizeSourcesForStorage(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.map((src) => {
    const out = {};
    for (const field of STORED_SOURCE_FIELDS) {
      if (src?.[field] !== undefined) out[field] = src[field];
    }
    return out;
  });
}

/**
 * Serialize a turn's metadata ({ Sources, Trace, ContextUsage }) for the
 * session row: presigned URIs stripped, at most MAX_STORED_SOURCES sources,
 * and if the JSON is still over MAX_STORED_METADATA_CHARS the excerpts are
 * dropped, then sources are halved until it fits.
 *
 * @param {{Sources?: Array<object>, Trace?: object, ContextUsage?: object}} metadata
 * @returns {string} JSON string for the `metadata` attribute.
 */
export function buildStoredMetadata(metadata) {
  let sources = sanitizeSourcesForStorage(metadata?.Sources).slice(0, MAX_STORED_SOURCES);
  const serialize = () => JSON.stringify({ ...metadata, Sources: sources });

  let json = serialize();
  if (json.length <= MAX_STORED_METADATA_CHARS) return json;

  sources = sources.map(({ excerpt, ...rest }) => rest);
  json = serialize();
  while (json.length > MAX_STORED_METADATA_CHARS && sources.length > 0) {
    sources = sources.slice(0, Math.floor(sources.length / 2));
    json = serialize();
  }
  return json;
}
