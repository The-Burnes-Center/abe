/**
 * @module shared-node/auth
 *
 * Admin check shared by the Node Lambdas behind the HTTP API JWT authorizer.
 *
 * Each Lambda directory holds a symlink to this file (e.g.
 * `excel-index/api/auth.mjs -> ../../shared-node/auth.mjs`). CDK copies
 * symlinks that point outside an asset directory as real files
 * (SymlinkFollowMode.EXTERNAL, the default), so every deployed bundle gets
 * its own copy and there is still exactly one source.
 *
 * Admins are members of the Cognito group named by ADMIN_GROUP_NAME
 * (default "Admin"), read from the ID token's `cognito:groups` claim.
 */

const DEFAULT_ADMIN_GROUP = "Admin";

/**
 * Normalize a `cognito:groups` claim into a list of group names.
 *
 * Behind the HTTP API JWT authorizer the claim arrives in several shapes
 * depending on how API Gateway stringified it:
 *   - an array: ["Admin", "Staff"]
 *   - a JSON string: '["Admin","Staff"]'
 *   - a bracketed string: "[Admin Staff]" or "[Admin, Staff]"
 *   - a plain string: "Admin"
 *
 * @param {unknown} claim
 * @returns {string[]}
 */
export function parseGroupsClaim(claim) {
  if (Array.isArray(claim)) {
    return claim.map((g) => String(g).trim()).filter(Boolean);
  }
  if (typeof claim !== "string") return [];
  const raw = claim.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parseGroupsClaim(parsed);
    } catch {
      // Not JSON: API Gateway's "[a b]" / "[a, b]" form, handled below.
    }
    return raw.slice(1, raw.endsWith("]") ? -1 : undefined)
      .split(/[\s,]+/)
      .map((g) => g.replace(/^"|"$/g, "").trim())
      .filter(Boolean);
  }
  return raw.split(/[\s,]+/).filter(Boolean);
}

/**
 * Groups of the caller, from the JWT authorizer claims.
 *
 * @param {object} event - API Gateway HTTP API (payload v2) event.
 * @returns {string[]}
 */
export function getGroups(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  return parseGroupsClaim(claims?.["cognito:groups"]);
}

/**
 * True only when the caller is in the admin group (exact name match, never a
 * substring: "NotAdmin" or "Admins" do not count).
 *
 * @param {object} event
 * @returns {boolean}
 */
export function isAdmin(event) {
  const adminGroup = process.env.ADMIN_GROUP_NAME || DEFAULT_ADMIN_GROUP;
  return getGroups(event).includes(adminGroup);
}

/**
 * Standard 403 response for non-admin callers.
 *
 * @param {Record<string, string>} [headers]
 * @returns {{statusCode: number, headers: Record<string, string>, body: string}}
 */
export function forbidden(headers = {}) {
  return {
    statusCode: 403,
    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ error: "You need administrator access to do this." }),
  };
}
