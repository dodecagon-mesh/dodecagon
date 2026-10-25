import { expect, test } from 'bun:test';

// existing renderer tests register process-global module mocks; native DB scenarios need their real imports
test('native message database consumer scenarios', () => {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      'test',
      new URL('./database.native.ts', import.meta.url).pathname
    ],
    cwd: import.meta.dir + '/../../../../..',
    stdout: 'pipe',
    stderr: 'pipe'
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
