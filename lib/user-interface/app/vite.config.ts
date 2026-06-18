/// <reference types="vitest" />
import { defineConfig } from "vite";
import fs from "fs";
import path from "path";
import react from "@vitejs/plugin-react";
import { brand } from "./src/common/brand";

const isDev = process.env.NODE_ENV === "development";

// https://vitejs.dev/config/
export default defineConfig({
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
    isDev && {
      name: "aws-exports",
      writeBundle() {
        const outputPath = path.resolve("public/aws-exports.json");

        // Write the modified JSON data to the public folder
        fs.writeFileSync(
          outputPath,
          JSON.stringify(
            {
              aws_project_region: process.env.AWS_PROJECT_REGION,
              aws_cognito_region: process.env.AWS_COGNITO_REGION,
              aws_user_pools_id: process.env.AWS_USER_POOLS_ID,
              aws_user_pools_web_client_id:
                process.env.AWS_USER_POOLS_WEB_CLIENT_ID,
              config: {
                api_endpoint: `https://${process.env.API_DISTRIBUTION_DOMAIN_NAME}/api`,
                websocket_endpoint: `wss://${process.env.API_DISTRIBUTION_DOMAIN_NAME}/socket`,
                rag_enabled: ["T", "t", "true", "True", "TRUE", "1"].includes(
                  process.env.RAG_ENABLED
                ),
                default_embeddings_model: process.env.DEFAULT_EMBEDDINGS_MODEL,
                default_cross_encoder_model:
                  process.env.DEFAULT_CROSS_ENCODER_MODEL,
              },
            },
            null,
            2
          ),
          "utf-8"
        );
      },
    },
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
});
