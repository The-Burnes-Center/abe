module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
  plugins: ["react-refresh"],
  rules: {
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
    // `const { node, ...rest } = props` drops a prop on purpose; `_name`
    // marks an intentionally unused binding.
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        ignoreRestSiblings: true,
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
  },
  overrides: [
    {
      // Test files mock modules and build loose fixtures; fast refresh
      // does not apply to them.
      files: ["**/*.test.ts", "**/*.test.tsx", "src/test/**"],
      rules: {
        "react-refresh/only-export-components": "off",
      },
    },
  ],
};
