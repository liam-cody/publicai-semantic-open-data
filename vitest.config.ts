import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
    'import.meta.env.MODE': '"test"',
    'import.meta.env.VITE_HUB_SEARCH_BASE': JSON.stringify(
      'https://www.data.gv.at/api/hub/search'
    ),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 25_000,
  },
})
