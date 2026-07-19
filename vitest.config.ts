import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Deux projets de test :
// - `node`   : logique pure (lib/**/*.test.ts). Comportement HISTORIQUE inchangé.
// - `dom`    : composants React rendus dans jsdom (**/*.test.tsx). Nouveau — permet
//              de tester le COMPORTEMENT CLIENT (un clic peint une case, une modale
//              ne se ferme pas au mauvais moment…), invisible à la couche `node`.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['lib/**/*.test.ts'],
          globals: false,
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['**/*.test.tsx'],
          exclude: ['node_modules/**', '.next/**'],
          globals: false,
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
