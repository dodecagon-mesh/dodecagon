import { describe, expect, test } from 'bun:test';

// each process keeps transport mocks isolated while consuming the production DB collections
describe('native message delivery', () => {
  for (const scenario of [
    'ordered-immediate',
    'event-before-error',
    'event-unblocks-next-send',
    'explicit-retry',
    'attachment-expiry',
    'expiry-event-before-error',
    'ambiguous-attachment-error',
    'cancel-releases-files',
    'session-reset',
    'cleanup-before-scope-observer',
    'scope-during-readback',
    'scope-during-reupload',
    'scope-security',
    'temporary-reconnect',
    'confirmed-deletion-and-quote',
    'ack-deletion-before-settlement'
  ]) {
    test(scenario, async () => {
      const result = Bun.spawnSync(
        [
          process.execPath,
          'run',
          new URL('./outbox.run.ts', import.meta.url).pathname,
          scenario
        ],
        {
          cwd: import.meta.dir + '/../../../..',
          stdout: 'pipe',
          stderr: 'pipe'
        }
      );
      expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    });
  }
  test('expiry recovery cancels the actual upload XHR on scope reset', () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        'run',
        new URL('./delivery-upload.run.ts', import.meta.url).pathname
      ],
      { cwd: import.meta.dir + '/../../../..', stdout: 'pipe', stderr: 'pipe' }
    );
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  });
  test('delayed acknowledgement preserves an earlier in-flight conversation dependency', () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        'run',
        new URL('./delivery-order.run.ts', import.meta.url).pathname
      ],
      { cwd: import.meta.dir + '/../../../..', stdout: 'pipe', stderr: 'pipe' }
    );
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  });
});
