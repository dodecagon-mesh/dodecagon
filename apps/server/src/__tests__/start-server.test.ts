import { describe, expect, test } from 'bun:test';
import path from 'path';

const bundlePath = path.resolve(
  import.meta.dir,
  '..',
  '..',
  '..',
  'client',
  'dist',
  'server',
  'server.js'
);

const bundleDirectory = path.dirname(bundlePath);

// the bundle travels inside the binary of the server and is imported from the
// data directory, where node_modules cannot be resolved. only the built in
// modules of node may stay outside
const ALLOWED_EXTERNALS = [
  'async_hooks',
  'crypto',
  'os',
  'process',
  'stream',
  'tty',
  'util'
];

// the bundle travels inside the binary of the server and is imported from the
// data directory, so the routes of the start server only work when the bundle
// was built
const loadBundle = async () => {
  const mod = await import(bundlePath);

  return mod.default as {
    fetch: (request: Request) => Promise<Response>;
  };
};

const listBundleFiles = async (): Promise<string[]> => {
  const files = [bundlePath];
  const assets = path.join(bundleDirectory, 'assets');
  const entries = await Array.fromAsync(
    new Bun.Glob('*.js').scan({ cwd: assets })
  );

  for (const entry of entries) {
    files.push(path.join(assets, entry));
  }

  return files;
};

describe('the start server bundle', () => {
  test('answers the health check through the fetch handler', async () => {
    const entry = await loadBundle();
    const response = await entry.fetch(new Request('http://localhost/healthz'));

    expect(response.status).toBe(200);

    const body = (await response.json()) as { status: string };

    expect(body.status).toBe('ok');
  });

  test('keeps every dependency inside the bundle', async () => {
    const files = await listBundleFiles();
    const external = new Set<string>();
    const transpiler = new Bun.Transpiler({ loader: 'js' });

    for (const file of files) {
      const source = await Bun.file(file).text();
      for (const { path: specifier } of transpiler.scanImports(source)) {
        const name = specifier.replace(/^node:/, '');

        // a relative path stays inside the bundle
        if (name.startsWith('.') || name.startsWith('/')) {
          continue;
        }

        if (!ALLOWED_EXTERNALS.includes(name)) {
          external.add(name);
        }
      }
    }

    expect([...external]).toEqual([]);
  });
});
