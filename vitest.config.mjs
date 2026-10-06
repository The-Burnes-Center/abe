import { defineConfig, configDefaults } from "vitest/config";

// The backend uses vitest only for Node Lambda unit tests (`npm run test:lambda`).
// Discover every *.test.mjs under the Lambda sources, skipping node_modules and
// stray agent worktrees under .claude so local runs match CI's clean checkout.
export default defineConfig({
  test: {
    include: ["lib/chatbot-api/functions/**/*.test.mjs", "lib/authorization/**/*.test.mjs"],
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/node_modules/**"],
  },
});
