/**
 * scripts/sync-brand.ts — Generate the frontend's brand artifacts from the
 * single source of truth at `config/brand.ts`.
 *
 * The Vite frontend is bundled in isolation (CDK runs `npm ci && npm run build`
 * with only `lib/user-interface/app` as input), so it can't import the root
 * config directly. This script resolves the brand (applying any env-var
 * overrides) and writes committed, standalone-buildable copies:
 *
 *   - lib/user-interface/app/src/common/brand.ts   (imported by theme.ts, constants.ts, etc.)
 *   - lib/user-interface/app/public/manifest.json  (PWA manifest)
 *
 * Run via `npm run brand:sync`. It also runs automatically before `npm run
 * build` (prebuild) and before the `synth`/`deploy` scripts. Re-run it after
 * editing config/brand.ts. index.html title/meta/font/favicon are injected at
 * build time by the Vite plugin in vite.config.ts (also from this brand data).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { brand } from "../config/brand";

const appDir = join(__dirname, "..", "lib", "user-interface", "app");

// 1) Frontend brand module — only the fields the UI needs, as resolved literals.
const frontendBrand = {
  assistantName: brand.assistantName,
  organizationName: brand.organizationName,
  parentOrg: brand.parentOrg,
  tagline: brand.tagline,
  welcomeMessage: brand.welcomeMessage,
  suggestedPrompts: brand.suggestedPrompts,
  supportContact: brand.supportContact,
  colorsLight: brand.colorsLight,
  colorsDark: brand.colorsDark,
  fontFamily: brand.fontFamily,
  fontUrl: brand.fontUrl,
  assets: brand.assets,
  themeColorLight: brand.themeColorLight,
  themeColorDark: brand.themeColorDark,
};

const brandTs = `/* AUTO-GENERATED from config/brand.ts by \`npm run brand:sync\`. Do not edit by hand. */
export const brand = ${JSON.stringify(frontendBrand, null, 2)} as const;

export type Brand = typeof brand;
export default brand;
`;
writeFileSync(join(appDir, "src", "common", "brand.ts"), brandTs);

// 2) PWA manifest.
const manifest = {
  id: "/",
  start_url: "/",
  name: brand.assistantName,
  short_name: brand.assistantName,
  description: brand.tagline,
  theme_color: brand.themeColorLight,
  background_color: brand.themeColorLight,
  display: "standalone",
  icons: [{ src: brand.assets.icon, sizes: "any", type: "image/svg+xml" }],
};
writeFileSync(
  join(appDir, "public", "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

console.log(
  `brand: synced ${brand.assistantName} (${brand.slug}) → frontend brand.ts + manifest.json`,
);
