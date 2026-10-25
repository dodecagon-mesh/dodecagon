import { expect, test } from 'bun:test';

for (const window of ['detached-channel', 'partial-thread']) {
  for (const ordering of [
    'event-first',
    'response-first',
    'late-get-one-error',
    'delete-confirmed'
  ]) {
    test(`${window} keeps one acknowledged send outside its contiguous page (${ordering})`, () => {
      const result = Bun.spawnSync({
        cmd: ['bun', 'run', './message-delivery.run.ts', window, ordering],
        cwd: import.meta.dir,
        stdout: 'pipe',
        stderr: 'pipe'
      });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
    });
  }
}
