import { Amplify } from "aws-amplify";
import { fetchAuthSession, signOut } from "aws-amplify/auth";
import { brand } from "./brand";

// A lost/expired session should send the user back to the login exactly once
// per page load. Without this guard, a burst of failing calls (or the Hub
// `tokenRefresh_failure` event firing alongside an in-flight request) would each
// kick off their own reload.
let redirectingToLogin = false;
let signingOut = false;

const GLOBAL_SIGN_OUT_TIMEOUT_MS = 3000;

/**
 * Revoke every refresh token for the user (Cognito GlobalSignOut), using an
 * access token captured before the local session was cleared. Best effort:
 * the local sign-out has already happened, so a failure here only means other
 * devices stay signed in until their tokens expire.
 */
async function revokeAllSessions(accessToken: string): Promise<void> {
  const userPoolId = Amplify.getConfig().Auth?.Cognito?.userPoolId ?? "";
  const region = userPoolId.split("_")[0];
  if (!region) return;
  const domain = region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GLOBAL_SIGN_OUT_TIMEOUT_MS);
  try {
    await fetch(`https://cognito-idp.${region}.${domain}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.GlobalSignOut",
      },
      body: JSON.stringify({ AccessToken: accessToken }),
      signal: controller.signal,
    });
  } catch {
    // Network failure or timeout; see the note above.
  } finally {
    clearTimeout(timer);
  }
}

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

  /**
   * The session is gone (expired or revoked): clear what is left locally and
   * reload the current page, which renders the in-app login. After signing in
   * the user lands back on the same same-origin path. Safe to call from
   * anywhere; only the first call per page load does anything.
   */
  static redirectToLogin(): void {
    if (redirectingToLogin) return;
    redirectingToLogin = true;
    signOut()
      .catch(() => undefined)
      .finally(() => window.location.reload());
  }

  /**
   * Deliberate sign-out. Clears the local session first (so the user is signed
   * out on this device even if the network is down), then revokes the
   * session everywhere with the access token captured beforehand.
   */
  static async signOut(): Promise<void> {
    if (signingOut) return;
    signingOut = true;
    let accessToken: string | undefined;
    try {
      accessToken = (await fetchAuthSession()).tokens?.accessToken?.toString();
    } catch {
      // No usable session; the local clear below is all that's left to do.
    }
    try {
      await signOut();
    } catch {
      // Amplify failed to clear storage; reloading still drops in-memory state.
    }
    if (accessToken) await revokeAllSessions(accessToken);
    window.location.replace("/");
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
   * Format a UTC ISO 8601 timestamp in the deployment's time zone
   * (`brand.timezone`), e.g. "Feb 20, 2026, 9:17 AM".
   */
  static formatTimestamp(utcTimestamp: string | null | undefined): string {
    if (!utcTimestamp) {
      return "N/A";
    }

    try {
      const date = new Date(utcTimestamp);
      if (isNaN(date.getTime())) {
        return "Invalid date";
      }

      return new Intl.DateTimeFormat("en-US", {
        timeZone: brand.timezone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error formatting timestamp:", error);
      }
      return "Invalid date";
    }
  }

  /** Short label for the configured time zone, e.g. "EDT" or "GMT+1". */
  static timezoneLabel(): string {
    try {
      const part = new Intl.DateTimeFormat("en-US", {
        timeZone: brand.timezone,
        timeZoneName: "short",
      })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName");
      return part?.value ?? brand.timezone;
    } catch {
      return brand.timezone;
    }
  }
}
