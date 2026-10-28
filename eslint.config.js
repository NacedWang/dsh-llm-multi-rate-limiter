/**
 * ESLint flat config.
 *
 * The rules stay deliberately narrow: correctness only, no style opinions that
 * would fight the existing hand-formatted code. The browser bundle gets its own
 * block because it runs against DOM globals rather than Node's.
 */

const NODE_GLOBALS = {
  console: "readonly",
  process: "readonly",
  Buffer: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  AbortController: "readonly",
  URL: "readonly",
  Blob: "readonly",
  fetch: "readonly",
};

const BROWSER_GLOBALS = {
  ...NODE_GLOBALS,
  document: "readonly",
  window: "readonly",
  FileReader: "readonly",
  URL: "readonly",
  Blob: "readonly",
};

export default [
  {
    ignores: ["node_modules/**", "*.tgz"],
  },
  {
    // Host code, strategies and tests: Node, ESM.
    files: ["lib/**/*.js", "test/**/*.js", "eslint.config.js"],
    ignores: ["lib/client.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: NODE_GLOBALS,
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Browser bundle: DOM globals, and no `require`-shim pedantry.
    files: ["lib/client.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "script",
      globals: BROWSER_GLOBALS,
    },
    rules: {
      // The bundle is generated-shaped (module wrapper + require shim), so
      // undefined-global analysis produces only noise here.
      "no-undef": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-unreachable": "error",
    },
  },
];
