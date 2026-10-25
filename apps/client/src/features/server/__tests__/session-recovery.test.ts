import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('authenticated sessions survive outages and reloads but not revocation or logout', () => {
  const fixture = fileURLToPath(
    new URL('./session-recovery.fixture.ts', import.meta.url)
  );
  const result = spawnSync(process.execPath, ['test', fixture], {
    encoding: 'utf8'
  });
  expect(result.stderr + result.stdout).toContain('0 fail');
  expect(result.status).toBe(0);
}, 15_000);
