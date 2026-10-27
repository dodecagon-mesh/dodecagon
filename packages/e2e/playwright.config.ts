import { defineConfig, devices } from '@playwright/test';
import clientPackage from '../../apps/client/package.json' with { type: 'json' };
import { e2eDataPath } from './tests/statics';

// a dev server of the project can already hold the default ports, so the suite
// takes the ports from the environment and keeps the defaults for CI
const SERVER_PORT = Number(process.env.DOD_E2E_SERVER_PORT ?? 4991);
const CLIENT_PORT = Number(process.env.DOD_E2E_CLIENT_PORT ?? 5173);
const WEBRTC_PORT = Number(process.env.DOD_E2E_WEBRTC_PORT ?? 40000);

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.pw.ts',
  globalTeardown: './tests/setup/global.teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
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
      timeout: 30_000,
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
      timeout: 15_000,
      env: { SERVER_PORT: String(SERVER_PORT) }
    }
  ]
});
