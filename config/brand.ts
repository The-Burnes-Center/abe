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
 * Default brand: neutral "ABE". Palette: Red #C8102E (primary), Navy #0C3354,
 * Light Blue #297496, Black, White. Type: Libre Franklin. Replace the names,
 * colors and logo files below to rebrand a fork.
 */

/** Raw brand palette — the named swatches from the brand guide. */
export interface BrandPalette {
  red: string;
  navy: string;
  lightBlue: string;
  black: string;
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
  red: "#C8102E",
  navy: "#0C3354",
  lightBlue: "#297496",
  black: "#000000",
  white: "#FFFFFF",
};

export const brand: BrandConfig = {
  slug: env("BRAND_SLUG", "abe"),
  assistantName: env("ASSISTANT_NAME", "ABE"),
  shortName: env("SHORT_NAME", "ABE"),
  organizationName: env("ORGANIZATION_NAME", "Your Organization"),
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
    primary: palette.red,
    primaryDark: "#A00C24",
    primaryLight: "#FCE8EB",
    primaryContrast: palette.white,
    secondary: palette.lightBlue,
    secondaryLight: "#E6F0F4",
    headerBg: palette.navy,
    headerText: palette.white,
    chatHumanBg: palette.navy,
    chatHumanText: palette.white,
    info: palette.lightBlue,
    infoLight: "#E6F0F4",
  },
  colorsDark: {
    primary: "#EF5A6F",
    primaryDark: "#C8102E",
    primaryLight: "#3A1620",
    primaryContrast: "#1A0E12",
    secondary: "#4FA3C7",
    secondaryLight: "#10242E",
    headerBg: "#07223B",
    headerText: "#E8EDF2",
    chatHumanBg: "#15406B",
    chatHumanText: "#E8EDF2",
    info: "#4FA3C7",
    infoLight: "#0D1F3A",
  },
  fontFamily: '"Libre Franklin", "Helvetica Neue", Arial, sans-serif',
  fontUrl:
    "https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@300;400;500;600;700&display=swap",
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
