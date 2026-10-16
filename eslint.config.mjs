import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import playwright from "eslint-plugin-playwright";
import tseslint from "typescript-eslint";

/**
 * Who may import whom — the dependency rule, written down where the build can check
 * it (unidirectional architecture after Bulletproof React; ports and adapters for the
 * backend). See docs/architecture.md.
 */
const LAYER_RULES = [
  {
    target: "./src/core",
    from: ["./src/app", "./src/features", "./src/components", "./src/lib", "./src/contract", "./src/backend"],
    message: "core is the shared kernel: it depends on no other layer.",
  },
  {
    target: "./src/contract",
    from: ["./src/app", "./src/features", "./src/components", "./src/lib", "./src/backend"],
    message: "The HTTP contract may depend only on core.",
  },
  {
    target: "./src/backend",
    from: ["./src/app", "./src/features", "./src/components", "./src/lib"],
    message: "The backend is a separate service: it may depend only on core and the contract.",
  },
  {
    target: [
      "./src/app",
      "./src/components",
      "./src/lib",
      "./src/features/events",
      "./src/features/checkout",
      "./src/features/orders",
    ],
    from: "./src/backend",
    message: "Talk to the backend over HTTP (lib/api-client). Only the sandbox feature uses its port.",
  },
  {
    target: "./src/features/sandbox",
    from: "./src/backend",
    except: ["./index.ts"],
    message: "Use the backend's public port (@/backend), never its internals.",
  },
  {
    target: ["./src/components", "./src/lib"],
    from: ["./src/features", "./src/app"],
    message: "Shared code may not depend on features or routes.",
  },
  ...["events", "checkout", "orders", "sandbox"].map((feature) => ({
    target: `./src/features/${feature}`,
    from: ["./src/app", "./src/features"],
    except: [`./${feature}`],
    message: "Features are independent: share through core, lib or components, and compose them in app/.",
  })),
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "import/no-restricted-paths": ["error", { zones: LAYER_RULES }],
      "import/no-cycle": "error",
      "import/no-default-export": "error",

      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true, requireDefaultForNonUnion: true },
      ],
      // Numbers read naturally in messages ("Only 2 left"); everything else must be a string.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // `onClick={() => setOpen(false)}` is idiomatic React, not confusing.
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      // React event props accept promise-returning handlers (react-hook-form's handleSubmit).
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],

      // Naming, after the Google TypeScript Style Guide — see docs/conventions.md.
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "default", format: ["camelCase"], leadingUnderscore: "forbid", trailingUnderscore: "forbid" },
        { selector: "import", format: ["camelCase", "PascalCase"] },
        // camelCase values, CONSTANT_CASE constants, PascalCase components.
        { selector: "variable", format: ["camelCase", "UPPER_CASE", "PascalCase"] },
        { selector: "function", format: ["camelCase", "PascalCase"] },
        // `_` marks a positional parameter that's deliberately unused: `(_, index) => …`.
        { selector: "parameter", filter: { regex: "^_$", match: true }, format: null },
        { selector: "parameter", format: ["camelCase", "PascalCase"] },
        { selector: "typeLike", format: ["PascalCase"] },
        // Keys are data: HTTP headers, add-on ids, CSS custom properties.
        { selector: ["objectLiteralProperty", "objectLiteralMethod"], format: null },
        { selector: "typeProperty", format: ["camelCase"], filter: { regex: "^[a-z]", match: true } },
        // Booleans say what they are: isOpen, hasConfirmedAddOns, shouldRedirect.
        {
          selector: ["variable", "parameter", "typeProperty"],
          types: ["boolean"],
          format: ["PascalCase"],
          prefix: ["is", "has", "can", "should", "did", "was", "are"],
          // Exempt: Next.js route segment config (fixed names), and the `ok` discriminant of
          // Result, which mirrors `Response.ok`.
          filter: { regex: "^(dynamicParams|ok)$", match: false },
        },
      ],
    },
  },
  {
    // Next.js and tool configs require default exports.
    files: ["src/app/**/*.{ts,tsx}", "*.config.{ts,mts,mjs}", "src/instrumentation-client.ts"],
    rules: { "import/no-default-export": "off" },
  },
  {
    // Browser tests: no fixed waits, no floating promises, web-first assertions.
    ...playwright.configs["flat/recommended"],
    files: ["e2e/**/*.ts"],
  },
  {
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated by `msw init`; vendor code, regenerated on upgrade.
    "public/mockServiceWorker.js",
  ]),
]);

export default eslintConfig;
