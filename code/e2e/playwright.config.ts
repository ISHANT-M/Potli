import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173', headless: true },
});
