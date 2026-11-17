import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "data/**", "public/**", "web/dist/**"] },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    extends: [...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["web/src/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommended],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
