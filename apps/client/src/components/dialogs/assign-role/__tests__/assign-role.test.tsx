import { expect, test } from 'bun:test';

type TRenderResult = {
  dialogMarkup: string;
  selectedMarkup: string;
  longNameMarkup: string;
  emptyMarkup: string;
};

const runRender = (): TRenderResult => {
  const proc = Bun.spawnSync({
    cmd: ['bun', 'run', './assign-role.render.tsx'],
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

test('roles the member already has are not offered again', () => {
  const { dialogMarkup } = runRender();

  expect(dialogMarkup).not.toContain('>Guest<');
  expect(dialogMarkup).toContain('value="4"');
  expect(dialogMarkup).toContain('value="6"');
});

test('an empty choice set explains that every role is already assigned', () => {
  const { emptyMarkup } = runRender();

  expect(emptyMarkup).toContain('This user already has all available roles.');
  expect(emptyMarkup).not.toContain('role="radiogroup"');
});
