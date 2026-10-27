import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { playwright } from '@vitest/browser-playwright';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { fsAllow } from './vite-fs-allow';

const systemChromium =
  process.platform === 'linux' && existsSync('/usr/bin/chromium')
    ? '/usr/bin/chromium'
    : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    entries: ['src/visual-tests/**/*.vrt.ts'],
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'embla-carousel-react',
      'filesize'
    ]
  },
  resolve: {
    alias: [
      // the tests run in the browser without the start server, so the server
      // functions get a stub with the same shape
      {
        find: /^@tanstack\/react-start$/,
        replacement: path.resolve(
          import.meta.dirname,
          './src/visual-tests/start-stub.ts'
        )
      },
      {
        find: /^@\//,
        replacement: path.resolve(import.meta.dirname, './src') + '/'
      }
    ],
    dedupe: ['react', 'react-dom']
  },
  define: {
    // the connect screen footer shows the app version, so the screenshots use a
    // fixed one instead of the version of the current build
    VITE_APP_VERSION: JSON.stringify('0.0.0-test'),
    VITE_SENTRY_DSN: JSON.stringify(''),
    VITE_SERVER_PORT: JSON.stringify(process.env.DODECAGON_TEST_PORT || '4991')
  },
  server: { fs: { allow: fsAllow } },
  test: {
    include: ['src/visual-tests/**/*.vrt.ts'],
    globalSetup: ['./src/visual-tests/global-setup.ts'],
    setupFiles: ['./src/visual-tests/browser-setup.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        actionTimeout: 5_000,
        contextOptions: { timezoneId: 'UTC' },
        launchOptions: systemChromium
          ? { executablePath: systemChromium }
          : undefined
      }),
      instances: [
        {
          browser: 'chromium',
          viewport: { width: 1440, height: 900 }
        }
      ]
    }
  }
});
