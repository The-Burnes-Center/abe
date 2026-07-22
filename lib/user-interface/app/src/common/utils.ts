import { fetchAuthSession, signInWithRedirect, signOut } from "aws-amplify/auth";

// A lost/expired session should send the user back to the login exactly once
// per page load. Without this guard, a burst of failing calls (or the Hub
// `tokenRefresh_failure` event firing alongside an in-flight request) would each
// kick off their own redirect.
let redirectingToLogin = false;

// Whether this deployment uses the in-app login page (no SSO provider) instead
// of the Cognito hosted UI. Set once by AppConfigured after aws-exports.json
// loads; the session-loss handlers below run outside React and read it here.
let nativeAuthEnabled = false;

export class Utils {
  // static isDevelopment() {
  //   return import.meta.env.MODE === "development";
  // }

  // eslint-disable-next-line @typescript-eslint/ban-types
  static isFunction(value: unknown): value is Function {
    return typeof value === "function";
  }

  static classNames(...classes: string[]) {
    return classes.filter(Boolean).join(" ");
  }

  static generateUUID() {
    if (crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    if (crypto && crypto.getRandomValues) {
      if (import.meta.env.DEV) {
        console.log(
          "crypto.randomUUID is not available using crypto.getRandomValues"
        );
      }

      return ("" + [1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(
        /[018]/g,
        (ch) => {
          const c = Number(ch);
          return (
            c ^
            (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
          ).toString(16);
        }
      );
    }

    if (import.meta.env.DEV) {
      console.log("crypto is not available");
    }
    let date1 = new Date().getTime();
    let date2 =
      (typeof performance !== "undefined" &&
        performance.now &&
        performance.now() * 1000) ||
      0;

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        let r = Math.random() * 16;
        if (date1 > 0) {
          r = (date1 + r) % 16 | 0;
          date1 = Math.floor(date1 / 16);
        } else {
          r = (date2 + r) % 16 | 0;
          date2 = Math.floor(date2 / 16);
        }

        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      }
    );
  }

  static delay(delay: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, delay);
    });
  }

  static findElementInParents(element: HTMLElement | null, tagName: string) {
    let current: HTMLElement | null = element;
    while (current) {
      if (current.tagName === tagName) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  static getErrorMessage(error: unknown): string {
    if (error == null) return "Unknown error";
    if (typeof error === "object" && "errors" in error && Array.isArray((error as { errors: unknown[] }).errors)) {
      return (error as { errors: { message?: string }[] }).errors
        .map((e) => e?.message ?? "Unknown error")
        .join(", ");
    }
    if (typeof (error as Error).message === "string") {
      return (error as Error).message;
    }
    return String(error);
  }

  /**
   * Pulls the server-supplied error reason out of a non-OK fetch Response,
   * tolerating the two shapes our Python Lambdas return:
   *   - `json.dumps({ "error": "...", "message": "..." })` (object body)
   *   - `json.dumps("plain string message")` (string body)
   * Falls back to the HTTP status text and finally to the supplied default
   * so the caller always gets something user-meaningful to surface in a
   * notification instead of a generic "request failed".
   */
  static async extractServerError(
    response: Response,
    fallback: string,
  ): Promise<string> {
    try {
      const body = await response.json();
      if (typeof body === "string" && body.trim().length > 0) return body;
      if (body && typeof body === "object") {
        const fromObject =
          (body as { error?: string }).error ??
          (body as { message?: string }).message ??
          (body as { detail?: string }).detail;
        if (typeof fromObject === "string" && fromObject.trim().length > 0) {
          return fromObject;
        }
      }
    } catch {
      // Body wasn't JSON (or was empty); fall through to statusText / fallback.
    }
    if (response.statusText) return `${fallback} (${response.status} ${response.statusText})`;
    return fallback;
  }

  static urlSearchParamsToRecord(
    params: URLSearchParams
  ): Record<string, string> {
    const record: Record<string, string> = {};

    for (const [key, value] of params.entries()) {
      record[key] = value;
    }

    return record;
  }

  static bytesToSize(bytes: number): string {
    const sizes: string[] = ["Bytes", "KB", "MB", "GB", "TB", "PB"];

    if (bytes === 0) return "0 MB";
    const i: number = parseInt(
      Math.floor(Math.log(bytes) / Math.log(1024)).toString()
    );

    const sizeStr = i >= sizes.length ? "" : sizes[i];
    return Math.round(bytes / Math.pow(1024, i)) + " " + sizeStr;
  }

  static textEllipsis(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + "...";
  }

  static isValidURL(value: string) {
    if (value.length === 0 || value.indexOf(" ") !== -1) {
      return false;
    }

    const result = value.match(
      /(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/gi
    );

    return result !== null;
  }

  /** See the module-level flag above; called by AppConfigured once config loads. */
  static setNativeAuth(enabled: boolean): void {
    nativeAuthEnabled = enabled;
  }

  static isNativeAuth(): boolean {
    return nativeAuthEnabled;
  }

  /**
   * Send the user back to the login to (re-)authenticate. This is the single
   * "the session is gone" exit for the whole app: an expired or revoked session
   * quietly bounces to sign-in instead of stranding the user with a cryptic
   * "not authenticated" notification they can't act on. Safe to call from
   * anywhere — only the first call per page load actually redirects.
   *
   * Native deployments clear the dead local session and reload, which lands on
   * the in-app login page; SSO deployments redirect to the Cognito hosted UI.
   */
  static redirectToLogin(): void {
    if (redirectingToLogin) return;
    redirectingToLogin = true;
    if (nativeAuthEnabled) {
      signOut()
        .catch(() => undefined)
        .finally(() => window.location.replace("/"));
      return;
    }
    try {
      signInWithRedirect();
    } catch {
      // If the redirect itself fails there is nothing more we can do here.
    }
  }

  /**
   * Deliberate sign-out (user clicked "Sign out", or the UI decided the session
   * is unusable). SSO deployments rely on Amplify's own hosted-UI logout
   * redirect; native deployments clear the local session and reload so
   * AppConfigured lands on the in-app login page.
   */
  static signOut(): void {
    if (nativeAuthEnabled) {
      signOut()
        .catch(() => undefined)
        .finally(() => window.location.replace("/"));
      return;
    }
    try {
      signOut();
    } catch {
      // Nothing more we can do; the next API call will bounce to login.
    }
  }

  static async authenticate(): Promise<string> {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (!token) {
        throw new Error('No ID token in session');
      }
      return token;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error getting current user session:", error);
      }
      Utils.redirectToLogin();
      throw new Error('Authentication failed');
    }
  }

  /**
   * Converts a UTC ISO 8601 timestamp to Eastern Time (EST/EDT) formatted string.
   * Handles both EST and EDT automatically based on the date.
   * 
   * @param utcTimestamp - ISO 8601 timestamp string with Z suffix (e.g., "2026-02-20T14:17:00Z")
   * @returns Formatted date string in Eastern Time (e.g., "Feb 20, 2026, 9:17 AM")
   */
  /**
   * Parses a Cognito display name like "Kumar, Dhruv (A&F)" into
   * { displayName: "Kumar, Dhruv", agency: "A&F" }.
   * If no parenthesized suffix exists, agency is "Unknown".
   */
  static parseUserIdentity(rawName: string | null | undefined): {
    displayName: string;
    agency: string;
  } {
    if (!rawName || rawName.trim().length === 0) {
      return { displayName: "Unknown", agency: "Unknown" };
    }

    const match = rawName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (match) {
      return {
        displayName: match[1].trim(),
        agency: match[2].trim(),
      };
    }

    return { displayName: rawName.trim(), agency: "Unknown" };
  }

  static formatToEasternTime(utcTimestamp: string | null | undefined): string {
    if (!utcTimestamp) {
      return 'N/A';
    }

    try {
      const date = new Date(utcTimestamp);
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }

      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error formatting timestamp to Eastern Time:", error);
      }
      return 'Invalid date';
    }
  }
}
