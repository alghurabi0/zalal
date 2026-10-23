import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // CLAUDE.md: @ts-ignore only with a comment explaining why.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": "allow-with-description", "ts-expect-error": "allow-with-description" },
      ],
    },
  },
  // Turns off stylistic rules that Prettier owns. Keep last.
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "design/**",
    // Built by `serwist build`.
    "public/sw*",
  ]),
]);

export default eslintConfig;
