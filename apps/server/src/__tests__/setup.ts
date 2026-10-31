import { Database } from 'bun:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, mock } from 'bun:test';
import { type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import fs from 'fs/promises';
import path from 'path';
import { DATA_PATH } from '../helpers/paths';
import { clearVoiceMoveGrantsForTests } from '../helpers/voice-move-grants';
import { createHttpServer } from '../http';
import { pluginManager } from '../plugins';
import { drainActivityLogQueue } from '../queues/activity-log';
import { drainLoginsQueue } from '../queues/logins';
import { VoiceRuntime } from '../runtimes/voice';
import { loadMediasoup } from '../utils/mediasoup';
import { clearRateLimitersForTests } from '../utils/rate-limiters/rate-limiter';
import { clearUserSocketsForTests } from '../utils/wss';
import { setTestDb } from './mock-db';
import { restoreTestDb } from './test-db-template';
import { resetTestVoiceConnections } from './voice-connection';

/**
 * Global test setup - creates a fresh isolated database before each test.
 * This ensures tests don't interfere with each other.
 *
 * The database is:
 * 1. Copied from the migrated and seeded image (fast, isolated)
 * 2. Set as the mocked db (via setTestDb)
 * 3. Cleaned up after the test
 *
 * The image itself is built once per process in mock-db.ts, which migrates and seeds a
 * database at module load. Copying it per test gives every test the same rows and the
 * same ids a migrate and a seed of its own would have produced.
 */

const DISABLE_CONSOLE = true;
const CLEANUP_AFTER_FINISH = true;

type TTestLogEntry = {
  level: 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'fatal';
  message: string;
};

// the suite silences the logger, which used to make "caught the error, logged it and carried
// on" indistinguishable from success. entries are collected here so a test can assert that a
// path really did fail quietly. cleared before every test by the beforeEach below
const testLogs: TTestLogEntry[] = [];

const findTestLog = (level: TTestLogEntry['level'], substring: string) =>
  testLogs.find(
    (entry) => entry.level === level && entry.message.includes(substring)
  );

if (DISABLE_CONSOLE) {
  const noop = () => {};

  global.console.log = noop;
  global.console.info = noop;
  global.console.warn = noop;
  global.console.debug = noop;

  const record =
    (level: TTestLogEntry['level']) =>
    (...args: unknown[]) => {
      testLogs.push({ level, message: args.map(String).join(' ') });
    };

  mock.module('../logger', () => ({
    logger: {
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      debug: record('debug'),
      trace: record('trace'),
      fatal: record('fatal')
    }
  }));
}

let tdb: BunSQLiteDatabase;
let sqlite: Database | null = null;
let testsBaseUrl: string;

const originalFetch = globalThis.fetch;

/**
 * The test http server runs in this process, so it shares the event loop with the tests.
 * A request the previous test started can still be in flight when the harness closes and
 * swaps the database, and the harness waits for every request the test made to be
 * answered first. A handler that reads the database after the swap throws against a
 * closed connection, and the request is answered against the next test's database
 * instead of the one it started on.
 */
const pendingRequests = new Set<Promise<unknown>>();
const idleWaiters: Array<() => void> = [];

const releaseRequest = (request: Promise<unknown>) => {
  if (!pendingRequests.delete(request)) return;

  if (pendingRequests.size > 0) return;

  for (const waiter of idleWaiters.splice(0)) waiter();
};

/**
 * The tests call the global fetch, so the harness counts the requests they leave in
 * flight. A request that is still on the wire is invisible to the server, and the
 * database it is going to read has to stay open until it has been answered.
 */
const trackClientRequest = (
  input: Parameters<typeof originalFetch>[0],
  init?: Parameters<typeof originalFetch>[1]
): Promise<Response> => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  if (!testsBaseUrl || !url.startsWith(testsBaseUrl)) {
    return originalFetch(input, init);
  }

  // bun's node:http closes the keep alive socket of a streamed response every so often,
  // and the fetch client keeps that closed socket in its pool. the next request written
  // on it fails with ECONNRESET, which lands on whatever test runs next. asking the
  // server to close the connection after every response leaves no socket in the pool
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  );

  headers.set('Connection', 'close');

  const request = originalFetch(input, { ...init, headers });

  pendingRequests.add(request);

  // the response headers are the last thing a handler does, so the request is done with
  // the database once they arrive
  request.then(
    () => releaseRequest(request),
    () => releaseRequest(request)
  );

  return request;
};

const waitForAnsweredRequests = async () => {
  if (pendingRequests.size === 0) return;

  await new Promise<void>((resolve) => {
    idleWaiters.push(resolve);
  });
};

/**
 * A test that puts its own fetch in place (the marketplace registry is served from a
 * stub) hands the raw fetch back when it is done, which would take the tracker with
 * it and leave the rest of the suite without a count of the requests in flight. The
 * tracker is put back before every test instead of once for the whole process.
 */
const installFetchTracker = () => {
  if (globalThis.fetch === (trackClientRequest as typeof globalThis.fetch))
    return;

  globalThis.fetch = trackClientRequest as typeof globalThis.fetch;
};

beforeAll(async () => {
  const server = await createHttpServer(0);
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Test HTTP server did not bind to a TCP port');
  }

  await loadMediasoup();

  testsBaseUrl = `http://localhost:${address.port}`;

  installFetchTracker();
});

beforeEach(() => {
  installFetchTracker();

  testLogs.length = 0;

  clearRateLimitersForTests();
  clearVoiceMoveGrantsForTests();
  clearUserSocketsForTests();
  resetTestVoiceConnections();
  VoiceRuntime.clearRegistryForTests();

  if (sqlite) {
    try {
      sqlite.close();
    } catch {
      // ignore
    }
  }

  const restored = restoreTestDb();

  sqlite = restored.sqlite;
  tdb = restored.db;

  // updates the mocked db to use this new test database
  setTestDb(tdb);
});

afterEach(async () => {
  // the plugin manager is a process wide singleton, so a plugin a test loaded would otherwise
  // keep its hooks running in every test file after it (a beforeFileSave hook rewriting uploads)
  await pluginManager.unloadPlugins();

  // a test that turns rate limiting off and fails before turning it back on would leave it off
  globalThis.disableRateLimiting = false;

  // spies replace exports on the shared module objects, so they have to be undone before the
  // next test, or the next test file, imports the stub instead of the real function
  mock.restore();

  // the queues outlive the test, so a job still in flight here would land in whichever database
  // the next test creates, or throw against a closed one. draining first is what keeps a queued
  // side effect inside the test that caused it
  await drainLoginsQueue();
  await drainActivityLogQueue();

  // the server shares the event loop with the tests, so a request the test started can
  // still be in flight here. closing the database under it would make the handler throw
  // against a closed connection, and the request would be answered against the next
  // test's database instead of the one it started on
  await waitForAnsweredRequests();

  if (sqlite) {
    try {
      sqlite.close();
      sqlite = null;
    } catch {
      // ignore
    }
  }
});

afterAll(async () => {
  if (!CLEANUP_AFTER_FINISH) return;

  const expectedTestPath = path.resolve(process.cwd(), './data-test');

  if (path.resolve(DATA_PATH) !== expectedTestPath) return;

  try {
    await fs.rm(DATA_PATH, { recursive: true });
  } catch {
    // ignore
  }
});

export { findTestLog, tdb, testLogs, testsBaseUrl };
