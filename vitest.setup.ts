// Setup du projet de test `dom` (jsdom). Étend `expect` avec les matchers
// @testing-library/jest-dom (toBeInTheDocument, toHaveTextContent…) et nettoie
// le DOM entre chaque test pour qu'ils restent isolés.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
