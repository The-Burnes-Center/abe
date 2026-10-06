/**
 * config/brand.ts — Single source of truth for all white-label brand identity.
 *
 * This is the ONE file to edit when deploying under a new brand. It is
 * imported directly by the CDK/backend code. The frontend (a separately
 * bundled Vite app) cannot import files outside its own directory, so a
 * generated copy is written to `lib/user-interface/app/src/common/brand.ts`
 * by `scripts/sync-brand.ts` (run `npm run brand:sync`). That generated file
 * is committed so the frontend always builds standalone.
 *
 * A handful of values can be overridden per-deployment via environment
 * variables (same pattern as PRIMARY_MODEL_ID), letting one build target
 * multiple brands without code edits.
 *
 * Default brand: ABE by AI for Impact. Palette from ai4impact.ai: primary
 * #376BD1, navy #1F2D45, accent #6A9CFF, cream #F8F6F1, white. Type: Public
 * Sans (Google Fonts). Every text/background pair below is WCAG AA. Replace
 * the names, colors and logo files to rebrand a fork.
 */

/** Raw brand palette: the named swatches from the brand guide. */
export interface BrandPalette {
  primary: string;
  navy: string;
  accent: string;
  cream: string;
  white: string;
}

/** Brand-driven theme tokens (the subset of theme.ts that carries brand identity). */
export interface BrandColors {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  primaryContrast: string;
  secondary: string;
  secondaryLight: string;
  headerBg: string;
  headerText: string;
  chatHumanBg: string;
  chatHumanText: string;
  info: string;
  infoLight: string;
}

export interface BrandConfig {
  /** Lowercase, URL/resource-safe id. Drives stack name, Cognito domain, tags, dashboards. */
  slug: string;
  /** The assistant's display name. */
  assistantName: string;
  /** Compact name for tight spaces: avatars, input placeholder, tab titles, mobile header. */
  shortName: string;
  /** Owning organization, shown in UI and used in the system prompt. */
  organizationName: string;
  /** Parent org (optional sub-line). */
  parentOrg: string;
  /** Short marketing line / meta description. */
  tagline: string;
  /** Empty-state greeting on the chat landing. */
  welcomeMessage: string;
  /** Where to direct users when the assistant lacks an answer (system prompt). */
  supportContact: string;
  /** Optional extra domain context injected into the system prompt. "" = fully generic. */
  domainContext: string;
  /** IANA time zone used to display timestamps in the UI and backend (e.g. "America/New_York"). */
  timezone: string;
  /** Starter prompt chips shown on the empty chat screen. */
  suggestedPrompts: string[];
  palette: BrandPalette;
  colorsLight: BrandColors;
  colorsDark: BrandColors;
  /** CSS font-family stack used across the app. */
  fontFamily: string;
  /** Web-font stylesheet URL injected into index.html (Google Fonts, etc.). */
  fontUrl: string;
  /** Public asset paths (served from app/public). */
  assets: {
    logo: string;
    logoDark: string;
    favicon: string;
    icon: string;
    /** Optional demo clip on the Help page and onboarding. Hidden when the file is missing. */
    demoVideo: string;
  };
  /** <meta name="theme-color"> values for light/dark. */
  themeColorLight: string;
  themeColorDark: string;
}

const env = (key: string, fallback: string): string => process.env[key] ?? fallback;

const palette: BrandPalette = {
  primary: "#376BD1",
  navy: "#1F2D45",
  accent: "#6A9CFF",
  cream: "#F8F6F1",
  white: "#FFFFFF",
};

export const brand: BrandConfig = {
  slug: env("BRAND_SLUG", "abe"),
  assistantName: env("ASSISTANT_NAME", "ABE"),
  shortName: env("SHORT_NAME", "ABE"),
  organizationName: env("ORGANIZATION_NAME", "AI for Impact"),
  parentOrg: env("PARENT_ORG", ""),
  tagline: env("BRAND_TAGLINE", "Ask anything about your knowledge base."),
  welcomeMessage: env("WELCOME_MESSAGE", "What can I help you with?"),
  supportContact: env("SUPPORT_CONTACT", "your administrator"),
  domainContext: env("DOMAIN_CONTEXT", ""),
  timezone: env("BRAND_TIMEZONE", "America/New_York"),
  suggestedPrompts: [
    "Summarize the most recent document.",
    "What topics can you help me with?",
    "Find information about a specific subject.",
    "What documents are in the knowledge base?",
  ],
  palette,
  colorsLight: {
    primary: palette.primary, // white text 5.0:1
    primaryDark: "#2B56AD",
    primaryLight: "#F0F4FD", // primary text on it 4.55:1
    primaryContrast: palette.white,
    secondary: palette.navy,
    secondaryLight: "#EEF3FF",
    headerBg: palette.navy, // white text 13.8:1
    headerText: palette.white,
    chatHumanBg: palette.navy,
    chatHumanText: palette.white,
    info: "#2F62C9", // 5.7:1 on white
    infoLight: "#EEF3FF",
  },
  colorsDark: {
    primary: palette.accent, // dark text 7.0:1 (white fails)
    primaryDark: "#4F86F0",
    primaryLight: "#1A2A4A",
    primaryContrast: "#0B1220",
    secondary: "#9DBEFF",
    secondaryLight: "#16233B",
    headerBg: "#141D2E", // cream text 15.6:1
    headerText: palette.cream,
    chatHumanBg: "#2A3D5E", // cream text 10.1:1
    chatHumanText: palette.cream,
    info: palette.accent,
    infoLight: "#13213A",
  },
  fontFamily: '"Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  fontUrl:
    "https://fonts.googleapis.com/css2?family=Public+Sans:wght@300..700&display=swap",
  assets: {
    logo: "/images/logo.svg",
    logoDark: "/images/logo-white.svg",
    favicon: "/images/icon.svg",
    icon: "/images/icon.svg",
    demoVideo: env("BRAND_DEMO_VIDEO", "/demos/demo.mp4"),
  },
  themeColorLight: palette.white,
  themeColorDark: palette.navy,
};

export default brand;
