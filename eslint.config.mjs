// FILE: eslint.config.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  // Ignore build + generated output (prevents noisy linting and speeds up Vercel builds)
  {
    ignores: [
      "**/.next/**",
      "**/.vercel/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/coverage/**",

      // generated code (should never block deploy)
      "**/src/generated/**",
      "**/src/lib/graphql/generated/**",
    ],
  },

  // Next.js recommended rule-sets
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Project-wide tuning: keep signal, avoid blocking deploy on style-only issues
  {
    rules: {
      "@next/next/no-html-link-for-pages": "warn",
      "import/no-anonymous-default-export": "off",
    },
  },

  // JS/JSX: allow legacy require() patterns and make common “blockers” non-fatal
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          caughtErrors: "none",
        },
      ],

      "@typescript-eslint/no-unused-expressions": [
        "warn",
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],

      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // TS/TSX: keep unused checks as warnings (still visible, not deployment-blocking)
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          caughtErrors: "none",
        },
      ],

      "@typescript-eslint/no-unused-expressions": [
        "warn",
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],

      // If you regenerate GraphQL types and they still slip in, this prevents hard fails
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
