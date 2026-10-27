import { expect, test } from 'bun:test';

type TRenderResult = {
  setupMarkup: string;
  readyLinkMarkup: string;
  defaultReadyLinkMarkup: string;
  copied: string[];
};

const runRender = (): TRenderResult => {
  const proc = Bun.spawnSync({
    cmd: ['bun', 'run', './create-invite-dialog.render.tsx'],
    cwd: import.meta.dir
  });

  const stdout = proc.stdout.toString();

  expect(proc.exitCode).toBe(0);
  expect(stdout).toContain('__RESULT__');

  const marker = '__RESULT__';
  const lines = stdout.split('\n');
  const resultLine = lines.find((line) => line.startsWith(marker));

  expect(resultLine).toBeDefined();

  return JSON.parse(resultLine!.slice(marker.length)) as TRenderResult;
};

test('the ready link falls back to the default role, no expiry and no use limit', () => {
  const { defaultReadyLinkMarkup } = runRender();

  expect(defaultReadyLinkMarkup).toContain('Role: Default');
  expect(defaultReadyLinkMarkup).toContain('Never expires');
  expect(defaultReadyLinkMarkup).toContain('No use limit');
});

test('the ready link can be copied without leaving the dialog', () => {
  const { readyLinkMarkup, copied } = runRender();

  expect(readyLinkMarkup).toContain('Copy invite link');
  expect(copied).toEqual(['https://discord.rnd332.com/?invite=ready-code']);
});
