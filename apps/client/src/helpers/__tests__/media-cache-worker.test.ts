import { beforeAll, describe, expect, test } from 'bun:test';

type TResult = { name: string; ok: boolean; error?: string };

// the worker imports its own globals before it is loaded and the test runner has
// already created a module registry of its own, so it runs in a child process
const runWorkerScenarios = (): TResult[] => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', './media-cache-worker.run.ts'],
    cwd: import.meta.dir,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  if (!result.success) {
    throw new Error(result.stderr.toString());
  }

  const output = result.stdout.toString();
  const marker = output.indexOf('__RESULT__');

  if (marker === -1) {
    throw new Error(`no result in the worker output:\n${output}`);
  }

  return JSON.parse(output.slice(marker + '__RESULT__'.length)) as TResult[];
};

describe('media cache worker', () => {
  let results: TResult[] = [];

  beforeAll(() => {
    results = runWorkerScenarios();
  });

  const scenario = (name: string) =>
    results.find((entry) => entry.name === name);

  test.each([
    'serves a hit without a network call',
    'fetches and stores a miss',
    'drops the token and the expiry from the key',
    'ignores a request that is not an image',
    'does not store a response that is not ok',
    'serves the network answer without cache storage'
  ])('should pass the scenario: %s', (name) => {
    const result = scenario(name);

    expect(result).toBeDefined();
    expect(result?.error ?? null).toBeNull();
    expect(result?.ok).toBe(true);
  });
});
