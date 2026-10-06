import { defineConfig, configDefaults } from "vitest/config";

// The backend uses vitest only for Node Lambda unit tests (`npm run test:lambda`).
// Discover every *.test.mjs under the Lambda sources, skipping node_modules,
// stray agent worktrees under .claude (so local runs match CI's clean checkout)
// and generate-response/chat, a symlink to websocket-chat whose tests already run.
export default defineConfig({
  test: {
    include: ["lib/chatbot-api/functions/**/*.test.mjs"],
    exclude: [
      ...configDefaults.exclude,
      "**/.claude/**",
      "**/node_modules/**",
      "**/generate-response/chat/**",
    ],
  },
});
