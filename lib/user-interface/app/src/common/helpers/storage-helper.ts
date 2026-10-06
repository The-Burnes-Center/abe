import { NavigationPanelState } from "../types";
import { brand } from "../brand";

// Keys are namespaced by the brand slug so two forks served from the same
// origin (e.g. localhost during development) don't share preferences.
const PREFIX = brand.slug;
const LEGACY_PREFIX = "aws-genai-llm-chatbot";
const THEME_KEY = "theme";
const NAVIGATION_PANEL_STATE_KEY = "navigation-panel-state";
const ONBOARDING_SEEN_KEY = "onboarding-seen";
const KEYS = [THEME_KEY, NAVIGATION_PANEL_STATE_KEY, ONBOARDING_SEEN_KEY];
// Bump when onboarding changes enough that returning users should see it again.
const ONBOARDING_VERSION = "1";

export type ThemeMode = "light" | "dark";

const storageKey = (key: string) => `${PREFIX}-${key}`;

/*
 * localStorage can be missing or throw (private windows, blocked site data,
 * sandboxed iframes). Preferences are conveniences, so every access degrades
 * to "nothing stored" instead of crashing the app before it renders.
 */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(key));
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(storageKey(key), value);
  } catch {
    // Not persisted; the in-memory state still applies for this page load.
  }
}

/** One-time copy of values saved under the old upstream prefix. */
function migrateLegacyKeys(): void {
  try {
    const storage = window.localStorage;
    for (const key of KEYS) {
      const legacyKey = `${LEGACY_PREFIX}-${key}`;
      const legacyValue = storage.getItem(legacyKey);
      if (legacyValue === null) continue;
      if (storage.getItem(storageKey(key)) === null) {
        storage.setItem(storageKey(key), legacyValue);
      }
      storage.removeItem(legacyKey);
    }
  } catch {
    // Storage unavailable; nothing to migrate.
  }
}

migrateLegacyKeys();

function prefersDark(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  } catch {
    return false;
  }
}

export abstract class StorageHelper {
  /** The saved theme, or the OS preference when the user never chose one. */
  static getTheme(): ThemeMode {
    const value = read(THEME_KEY);
    if (value === "dark" || value === "light") return value;
    return prefersDark() ? "dark" : "light";
  }

  /**
   * Apply a theme to the document. `persist` is false for the initial
   * OS-derived theme so a later OS change still applies until the user picks
   * one explicitly.
   */
  static applyTheme(theme: ThemeMode, persist = true): ThemeMode {
    if (persist) write(THEME_KEY, theme);
    document.documentElement.style.setProperty("--app-color-scheme", theme);
    document.documentElement.setAttribute("data-theme", theme);
    return theme;
  }

  static getNavigationPanelState(): NavigationPanelState {
    const value = read(NAVIGATION_PANEL_STATE_KEY);
    if (!value) return { collapsed: false };
    try {
      return (JSON.parse(value) as NavigationPanelState | null) ?? {};
    } catch {
      return {};
    }
  }

  static setNavigationPanelState(state: Partial<NavigationPanelState>) {
    const newState = { ...this.getNavigationPanelState(), ...state };
    write(NAVIGATION_PANEL_STATE_KEY, JSON.stringify(newState));
    return newState;
  }

  static getOnboardingSeen(): boolean {
    return read(ONBOARDING_SEEN_KEY) === ONBOARDING_VERSION;
  }

  static setOnboardingSeen(): void {
    write(ONBOARDING_SEEN_KEY, ONBOARDING_VERSION);
  }
}
