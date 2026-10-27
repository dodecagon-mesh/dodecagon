import path from 'path';

// the shard runner gives every shard its own data directory, and the value it passes is
// already absolute. a plain `bunx playwright test` keeps the historical single directory.
// resolving here means the seed script, the global teardown and the server all agree on
// one absolute path regardless of the directory they are started from
const e2eDataPath = path.resolve(
  process.env.DOD_E2E_DATA_PATH ?? path.join(process.cwd(), 'e2e-data')
);

export { e2eDataPath };
