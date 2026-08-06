import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Les worktrees vivent sous .claude/worktrees/ — physiquement à l'intérieur
    // du dépôt. Sans cette ligne, un `npm run dev` lancé dans un worktree fait
    // remonter son .next/ dans le lint du dépôt principal : des milliers
    // d'erreurs sur du code compilé, qui noient les vraies. Chaque worktree a
    // sa propre copie du projet et se lint chez lui.
    ".claude/**",
    "**/.next/**",
  ]),
]);

export default eslintConfig;
