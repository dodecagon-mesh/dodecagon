import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const clientRoot = path.resolve(import.meta.dirname, '../..');
const repositoryRoot = path.resolve(clientRoot, '../..');
const dataPath = path.join(clientRoot, 'e2e-data');
const serverRoot = path.join(repositoryRoot, 'apps/server');
const serverEntry = path.join(serverRoot, 'src/index.ts');
const seedEntry = path.join(
  repositoryRoot,
  'packages/e2e/tests/setup/seed-db.ts'
);
const visualSeedEntry = path.join(import.meta.dirname, 'seed.ts');
const serverPreload = path.join(import.meta.dirname, 'server-preload.ts');
const visualTestServerPort = process.env.DODECAGON_TEST_PORT || '4991';
const serverUrl = `http://localhost:${visualTestServerPort}/info`;
const serverLifetimeMs = 180_000;

type TServerStartState = {
  error?: Error;
};

const run = (command: string, args: string[], timeoutMs = 30_000) => {
  const { promise, reject, resolve } = Promise.withResolvers<void>();
  const child = spawn(command, args, {
    cwd: clientRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DODECAGON_DATA_PATH: dataPath
    },
    signal: AbortSignal.timeout(timeoutMs),
    stdio: 'inherit'
  });

  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(
      new Error(
        `${command} ${args.join(' ')} exited with ${code ?? signal ?? 'unknown status'}`
      )
    );
  });

  return promise;
};

const delay = (milliseconds: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
};

const fetchServerInfo = (timeoutMs: number) =>
  fetch(serverUrl, { signal: AbortSignal.timeout(timeoutMs) });

const assertServerPortAvailable = async () => {
  let portIsOccupied = false;

  try {
    await fetchServerInfo(1_000);
    portIsOccupied = true;
  } catch {
    // No HTTP server responded on the visual-test port.
  }

  if (portIsOccupied) {
    throw new Error(
      `Visual tests require port ${visualTestServerPort}, but an HTTP server is already listening`
    );
  }
};

const waitForServer = async (
  server: ChildProcess,
  startState: TServerStartState
) => {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (startState.error) throw startState.error;
    if (server.exitCode !== null) {
      throw new Error(`Visual-test server exited with ${server.exitCode}`);
    }

    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const response = await fetchServerInfo(Math.min(1_000, remainingMs));
      if (response.ok) {
        await delay(50);
        if (startState.error) throw startState.error;
        if (server.exitCode !== null) {
          throw new Error(`Visual-test server exited with ${server.exitCode}`);
        }
        return;
      }
    } catch (error) {
      if (startState.error) throw startState.error;
      if (server.exitCode !== null) {
        throw new Error(`Visual-test server exited with ${server.exitCode}`);
      }
      if (Date.now() >= deadline) throw error;
    }

    await delay(100);
  }

  throw new Error('Visual-test server did not become ready within 30 seconds');
};

const stopServer = async (server: ChildProcess) => {
  if (!server.pid || server.exitCode !== null) return;

  const { promise: exited, resolve: resolveExit } =
    Promise.withResolvers<void>();
  server.once('exit', () => resolveExit());
  server.kill('SIGTERM');

  await Promise.race([
    exited,
    delay(5_000).then(() => {
      if (server.exitCode === null) server.kill('SIGKILL');
    })
  ]);
};

const startSetup = async () => {
  await assertServerPortAvailable();
  await run('bun', [seedEntry]);
  await run('bun', [visualSeedEntry]);

  const server = spawn('bun', ['--preload', serverPreload, serverEntry], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      // Match vitest.config.ts so authenticated joins do not reload the test iframe.
      DODECAGON_BUILD_VERSION: '0.0.0-test',
      DODECAGON_DATA_PATH: dataPath,
      DODECAGON_PORT: visualTestServerPort
    },
    stdio: 'inherit'
  });
  const startState: TServerStartState = {};
  server.once('error', (error) => {
    startState.error = error;
  });

  const lifetimeTimer = setTimeout(() => {
    void stopServer(server);
  }, serverLifetimeMs);
  lifetimeTimer.unref();

  const stopOnProcessExit = () => {
    if (server.exitCode === null) server.kill('SIGKILL');
  };
  process.once('exit', stopOnProcessExit);

  try {
    await waitForServer(server, startState);
  } catch (error) {
    clearTimeout(lifetimeTimer);
    process.off('exit', stopOnProcessExit);
    await stopServer(server);
    throw error;
  }

  return async () => {
    clearTimeout(lifetimeTimer);
    process.off('exit', stopOnProcessExit);
    await stopServer(server);
    await fs.rm(dataPath, { recursive: true, force: true });
  };
};

let setupPromise: ReturnType<typeof startSetup> | undefined;

export default function setup() {
  setupPromise ??= startSetup();
  return setupPromise;
}
