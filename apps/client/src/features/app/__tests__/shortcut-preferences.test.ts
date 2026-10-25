import { expect, test } from 'bun:test';

test('real preference actions persist custom bindings, reject conflicts, hydrate and reset', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', './shortcut-preferences.fixture.ts'],
    cwd: import.meta.dir,
    stdout: 'pipe',
    stderr: 'pipe'
  });
  if (!result.success) throw new Error(result.stderr.toString());
  const line = result.stdout
    .toString()
    .split('\n')
    .find((entry) => entry.startsWith('__SHORTCUTS__'));
  if (!line) throw new Error('No shortcut preference fixture output');
  const scenario = JSON.parse(line.slice('__SHORTCUTS__'.length));
  expect(scenario.customError).toBeUndefined();
  expect(JSON.parse(scenario.saved)).toEqual({
    mute: { code: 'KeyG', modifiers: ['Mod', 'Shift'] },
    deafen: null
  });
  expect(scenario.duplicateError).toEqual({
    type: 'duplicate',
    conflictingId: 'mute'
  });
  expect(scenario.afterDuplicate).toBe(scenario.saved);
  expect(scenario.customAction).toBe('mute');
  expect(scenario.oldAction).toBeUndefined();
  expect(scenario.disabledAction).toBeUndefined();
  expect(scenario.resetMute).toEqual({ deafen: null });
  expect(scenario.resetAll).toEqual({});
  expect(scenario.malformed).toEqual({});
});
