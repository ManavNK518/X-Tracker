import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Client code must never import server modules or environment configuration
    // (secrets live there). Pages and components talk to the server via /api only.
    files: ["src/components/**/*.{ts,tsx}", "src/lib/client/**/*.{ts,tsx}", "src/app/**/page.tsx", "src/app/**/layout.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server/*", "@/server/**"], message: "Client code must not import server modules. Use the API." },
            { group: ["@/config/env"], message: "Environment configuration (secrets) is server-only." },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".data/**", "playwright-report/**", "test-results/**", "drizzle/**"]),
]);

export default eslintConfig;
