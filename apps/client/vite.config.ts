import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import pkg from './package.json';
import { fsAllow } from './vite-fs-allow';

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      tanstackStart({
        client: {
          // the path is relative to the source folder of the project
          entry: 'client.tsx'
        },
        prerender: {
          // the pages are rendered by the server for every request, there is
          // nothing to prerender
          enabled: false
        },
        router: {
          // the tests of the server routes live next to the routes and must not
          // become routes themselves
          routeFileIgnorePattern: '__tests__'
        }
      }),
      react(),
      tailwindcss()
    ],
    build: {
      target: 'esnext',
      manifest: true
    },
    // parallel e2e shards each run their own vite server, and a shared node_modules/.vite
    // makes them rewrite the same optimized deps while the others read them
    ...(process.env.DOD_VITE_CACHE_DIR
      ? { cacheDir: path.resolve(process.env.DOD_VITE_CACHE_DIR) }
      : {}),
    // the start server bundle travels inside the server binary and is imported
    // from the data directory, where node_modules cannot be resolved. every
    // dependency has to be bundled into it. the dev server keeps the packages
    // external, there the commonjs build of react cannot be evaluated
    ...(command === 'build' ? { ssr: { noExternal: true } } : {}),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    },
    define: {
      VITE_APP_VERSION: JSON.stringify(pkg.version),
      VITE_SERVER_PORT: JSON.stringify(env.SERVER_PORT || '4991'),
      // the browser reports to the client project; a single-project deployment
      // keeps the server dsn as the only one it has
      VITE_SENTRY_DSN: JSON.stringify(
        env.SENTRY_CLIENT_DSN || env.SENTRY_DSN || ''
      ),
      VITE_SENTRY_ENVIRONMENT: JSON.stringify(env.SENTRY_ENVIRONMENT || mode)
    },
    server: {
      fs: { allow: fsAllow },
      proxy: {
        '/manifest.json': `http://localhost:${env.SERVER_PORT || 4991}`,
        // sanitizing rewrites message image urls to same-origin paths, which in dev is
        // this vite server rather than the one holding the files
        '/public': `http://localhost:${env.SERVER_PORT || 4991}`,
        // the marketplace registry is fetched from the server, not from a third party
        '/plugins/registry': `http://localhost:${env.SERVER_PORT || 4991}`
      }
    }
  };
});
