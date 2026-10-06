import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({});
const BUCKET = process.env.BUCKET;
const EXPIRATION_SECONDS = 3600;
const MAX_KEY_LENGTH = 1024;

const CONTENT_TYPE_MAP = {
  pdf: "application/pdf",
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// HTML opened inline from the bucket would run its scripts on the S3
// origin, so these are always served as downloads.
const DOWNLOAD_ONLY_EXTENSIONS = new Set(["html", "htm"]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

// Files Bedrock cites are uploaded with these extensions; anything else (e.g.
// random binaries) is rejected so an authenticated user cannot pull arbitrary
// objects out of the KB bucket.
const ALLOWED_EXTENSIONS = new Set(Object.keys(CONTENT_TYPE_MAP));

// Control characters (incl. NUL and DEL) and backslashes never appear in a
// legitimate document key.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/;

// System files that must never be handed out via a presigned URL even though
// their extension is otherwise allowed. `metadata.txt` is the auto-generated
// document inventory (every filename + AI summary); exposing it would let any
// authenticated user enumerate the whole KB and then pull each document.
const BLOCKED_BASENAMES = new Set(["metadata.txt"]);

/**
 * Validate a requested S3 key. Any Unicode filename is allowed (accents,
 * apostrophes, "#", CJK, ...); what is rejected is path traversal ("." or
 * ".." segments, a leading "/", empty segments), control characters and
 * backslashes.
 *
 * @param {unknown} s3Key
 * @returns {boolean}
 */
export function isSafeKey(s3Key) {
  if (typeof s3Key !== "string" || !s3Key || s3Key.length > MAX_KEY_LENGTH) return false;
  if (UNSAFE_CHARS.test(s3Key)) return false;
  return s3Key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Content-Disposition for a presigned GET: inline for viewable types,
 * attachment (RFC 5987 encoded filename) for HTML.
 *
 * @param {string} ext - Lowercase extension.
 * @param {string} basename - Original file name.
 * @returns {string}
 */
export function contentDisposition(ext, basename) {
  if (!DOWNLOAD_ONLY_EXTENSIONS.has(ext)) return "inline";
  return `attachment; filename*=UTF-8''${encodeURIComponent(basename)}`;
}

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const s3Key = body.s3Key;

    if (!s3Key || typeof s3Key !== "string") {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "s3Key is required" }) };
    }

    if (!isSafeKey(s3Key)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Invalid key" }) };
    }

    const basename = s3Key.split("/").pop() || "";
    if (BLOCKED_BASENAMES.has(basename.toLowerCase())) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Invalid key" }) };
    }

    const ext = basename.includes(".") ? basename.split(".").pop().toLowerCase() : "";
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "File type not allowed" }) };
    }
    const contentType = CONTENT_TYPE_MAP[ext] || "application/octet-stream";

    const signedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        ResponseContentDisposition: contentDisposition(ext, basename),
        ResponseContentType: contentType,
      }),
      { expiresIn: EXPIRATION_SECONDS }
    );

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ signedUrl }) };
  } catch (err) {
    console.error("Failed to generate signed URL:", err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "Failed to generate signed URL" }) };
  }
};
