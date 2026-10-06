/**
 * Admin detection from the Cognito ID token.
 *
 * Admins are members of the Cognito group `Admin`, delivered in the
 * `cognito:groups` claim. The UI check only decides what to show: every admin
 * API enforces the same rule server-side.
 */
import { useEffect, useState } from "react";
import { fetchAuthSession, type AuthSession } from "aws-amplify/auth";

export const ADMIN_GROUP = "Admin";

/**
 * Normalize the `cognito:groups` claim into a list of group names.
 * Accepts a real array, a JSON array string (`'["Admin","X"]'`), a bracketed
 * space/comma separated string (`"[Admin X]"`, `"[Admin, X]"`) or a single
 * group name (`"Admin"`).
 */
export function parseGroups(claim: unknown): string[] {
  if (Array.isArray(claim)) {
    return claim.filter((g): g is string => typeof g === "string").map((g) => g.trim());
  }
  if (typeof claim !== "string") return [];
  const raw = claim.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parseGroups(parsed);
    } catch {
      // Not JSON: fall through to the bracketed-list form.
    }
    return raw
      .slice(1, raw.endsWith("]") ? -1 : undefined)
      .split(/[\s,]+/)
      .map((g) => g.replace(/^["']|["']$/g, "").trim())
      .filter(Boolean);
  }
  return [raw];
}

type TokenPayload = Record<string, unknown> | undefined;

/** True when the ID token (or its payload) carries the exact `Admin` group. */
export function isAdmin(source: AuthSession | TokenPayload | null | undefined): boolean {
  if (!source) return false;
  const payload: TokenPayload =
    "tokens" in source
      ? ((source as AuthSession).tokens?.idToken?.payload as TokenPayload)
      : (source as TokenPayload);
  return parseGroups(payload?.["cognito:groups"]).includes(ADMIN_GROUP);
}

/** Resolve the current user's admin status; null while loading. */
export function useIsAdmin(): boolean | null {
  const [admin, setAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAuthSession()
      .then((session) => {
        if (!cancelled) setAdmin(isAdmin(session));
      })
      .catch(() => {
        if (!cancelled) setAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return admin;
}

/** Identity fields shown in the UI (header, self-action guards). */
export interface CurrentIdentity {
  username: string;
  email: string;
  name: string;
  sub: string;
}

export function identityFromPayload(payload: TokenPayload): CurrentIdentity {
  const str = (key: string) => (typeof payload?.[key] === "string" ? (payload[key] as string) : "");
  return {
    username: str("cognito:username"),
    email: str("email"),
    name: str("name"),
    sub: str("sub"),
  };
}
