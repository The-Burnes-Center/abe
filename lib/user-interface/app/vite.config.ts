/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import fs from "fs";
import path from "path";
import react from "@vitejs/plugin-react";
import { brand } from "./src/common/brand";

const TRUE_VALUES = ["1", "true", "yes", "on"];

/**
 * Build the runtime config (same shape CDK writes to aws-exports.json at
 * deploy time, see lib/user-interface/index.ts) from ABE_* variables in
 * `.env` / `.env.local`. Returns null when the required values are missing.
 */
function awsExportsFromEnv(env: Record<string, string>) {
  const required = [
    "ABE_REGION",
    "ABE_USER_POOL_ID",
    "ABE_USER_POOL_CLIENT_ID",
    "ABE_HTTP_ENDPOINT",
    "ABE_WS_ENDPOINT",
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) return { config: null, missing };
  const flag = (key: string, fallback: boolean) =>
    env[key] ? TRUE_VALUES.includes(env[key].toLowerCase()) : fallback;
  return {
    missing,
    config: {
      Auth: {
        region: env.ABE_REGION,
        userPoolId: env.ABE_USER_POOL_ID,
        userPoolWebClientId: env.ABE_USER_POOL_CLIENT_ID,
      },
      // Same form as the deployed config: HTTP API URL with a trailing slash.
      httpEndpoint: env.ABE_HTTP_ENDPOINT.replace(/\/?$/, "/"),
      wsEndpoint: env.ABE_WS_ENDPOINT,
      selfSignUpEnabled: flag("ABE_SELF_SIGNUP_ENABLED", false),
      evalEnabled: flag("ABE_EVAL_ENABLED", true),
    },
  };
}

/**
 * Local development only: serve /aws-exports.json from `.env` so
 * `npm run dev` works against a deployed stack. If the ABE_* values aren't
 * set, a hand-copied public/aws-exports.json (ignored by git) is served as a
 * normal static file instead.
 */
function devAwsExports(mode: string): Plugin {
  return {
    name: "dev-aws-exports",
    apply: "serve",
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), "ABE_");
      const { config, missing } = awsExportsFromEnv(env);
      const publicCopy = path.resolve("public/aws-exports.json");
      if (!config) {
        if (!fs.existsSync(publicCopy)) {
          server.config.logger.warn(
            `[aws-exports] Missing ${missing.join(", ")} in .env and no public/aws-exports.json. ` +
              "Copy .env.example to .env and fill it from your stack outputs (see README.md)."
          );
        }
        return;
      }
      const body = JSON.stringify(config, null, 2);
      server.middlewares.use("/aws-exports.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(body);
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    "process.env": {},
  },
  plugins: [
    {
      // Inject brand identity (from config/brand.ts via the generated brand.ts)
      // into index.html placeholders, at dev and build time.
      name: "brand-html",
      transformIndexHtml(html: string) {
        return html
          .replace(/%APP_TITLE%/g, brand.assistantName)
          .replace(/%APP_DESCRIPTION%/g, brand.tagline)
          .replace(/%APP_FONT_URL%/g, brand.fontUrl)
          .replace(/%APP_FAVICON%/g, brand.assets.favicon)
          .replace(/%APP_THEME_LIGHT%/g, brand.themeColorLight)
          .replace(/%APP_THEME_DARK%/g, brand.themeColorDark);
      },
    },
    devAwsExports(mode),
    react(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-mui": [
            "@mui/material",
            "@mui/icons-material",
            "@emotion/react",
            "@emotion/styled",
          ],
          "vendor-charts": ["@mui/x-charts"],
        },
      },
    },
  },
  server: {
    port: 3000,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**"],
    },
  },
}));
