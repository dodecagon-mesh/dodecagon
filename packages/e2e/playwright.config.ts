import { defineConfig, devices } from '@playwright/test';
import clientPackage from '../../apps/client/package.json' with { type: 'json' };
import { e2eDataPath } from './tests/statics';

// a dev server of the project can already hold the default ports, so the suite takes the
// ports from the environment and keeps the defaults for CI. the shard runner offsets both
// bases per shard, while a plain `bunx playwright test` runs on shard 1's block
const BASE_HTTP_PORT = Number(process.env.DOD_E2E_BASE_HTTP_PORT ?? 6100);
const BASE_WEBRTC_PORT = Number(process.env.DOD_E2E_BASE_WEBRTC_PORT ?? 15200);

// shard i owns the server + 10 + i * 10 and vite + 11 + i * 10, so two shards never share
// a port even when they start at the same time
const SERVER_PORT = Number(
  process.env.DOD_E2E_SERVER_PORT ?? BASE_HTTP_PORT + 10
);
const CLIENT_PORT = Number(
  process.env.DOD_E2E_CLIENT_PORT ?? BASE_HTTP_PORT + 11
);
const WEBRTC_PORT = Number(process.env.DOD_E2E_WEBRTC_PORT ?? BASE_WEBRTC_PORT);

const WORKERS = process.env.DOD_E2E_WORKERS
  ? Number(process.env.DOD_E2E_WORKERS)
  : process.env.CI
    ? 1
    : undefined;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.pw.ts',
  globalTeardown: './tests/setup/global.teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries:
    process.env.DOD_E2E_RETRIES !== undefined &&
    process.env.DOD_E2E_RETRIES.trim() !== ''
      ? Number(process.env.DOD_E2E_RETRIES)
      : process.env.CI
        ? 2
        : 0,
  workers: WORKERS,
  reporter: process.env.DOD_E2E_REPORTER ?? 'html',
  // every shard writes its own results, otherwise the shards race on screenshots and traces
  outputDir: process.env.DOD_E2E_OUTPUT_DIR ?? './test-results',
  timeout: Number(process.env.DOD_E2E_TIMEOUT ?? 60_000),
  expect: {
    timeout: Number(process.env.DOD_E2E_EXPECT_TIMEOUT ?? 10_000)
  },
  testIgnore: ['**/fixtures/**', '**/__tests__/seed-e2e.ts'],

  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'on-first-retry'
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],

  webServer: [
    {
      command: 'bun dev',
      cwd: '../../apps/server',
      port: SERVER_PORT,
      reuseExistingServer: false,
      timeout: Number(process.env.DOD_E2E_SERVER_START_TIMEOUT ?? 60_000),
      stdout: 'ignore',
      stderr: 'ignore',
      env: {
        DODECAGON_BUILD_VERSION: clientPackage.version,
        DODECAGON_DATA_PATH: e2eDataPath,
        DODECAGON_PORT: String(SERVER_PORT),
        DODECAGON_WEBRTC_PORT: String(WEBRTC_PORT)
      }
    },
    {
      command: `bun dev --port ${CLIENT_PORT} --strictPort`,
      cwd: '../../apps/client',
      port: CLIENT_PORT,
      stderr: 'ignore',
      stdout: 'ignore',
      reuseExistingServer: false,
      timeout: Number(process.env.DOD_E2E_CLIENT_START_TIMEOUT ?? 30_000),
      env: {
        SERVER_PORT: String(SERVER_PORT),
        // a shared dep cache is what makes concurrent vite servers fight over the
        // optimized deps directory, so each shard gets its own
        ...(process.env.DOD_VITE_CACHE_DIR
          ? { DOD_VITE_CACHE_DIR: process.env.DOD_VITE_CACHE_DIR }
          : {})
      }
    }
  ]
});
