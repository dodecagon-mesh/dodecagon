import { expect, test } from 'bun:test';

// Isolate DOM globals and module mocks from the rest of the client suite.
test('device discovery shares permitted endpoints without capturing or losing valid saved selections', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'test', './device-discovery.fixture.tsx'],
    cwd: import.meta.dir,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  expect(
    result.success,
    result.stdout.toString() + result.stderr.toString()
  ).toBe(true);
});
