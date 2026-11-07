import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import base from "./base.js";

/** Flat config for React libraries (no Next.js rules). */
export default [
  ...base,
  {
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
];
