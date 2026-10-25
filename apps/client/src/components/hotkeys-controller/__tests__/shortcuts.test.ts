import { describe, expect, test } from 'bun:test';
import {
  beginShortcutRecording,
  captureShortcut,
  formatShortcut,
  getShortcut,
  isShortcutRecording,
  normalizeShortcutOverrides,
  resolveShortcutBindings,
  validateShortcutBinding
} from '../shortcuts';

const keyEvent = (overrides: Partial<KeyboardEvent>) =>
  ({
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    defaultPrevented: false,
    isComposing: false,
    getModifierState: () => false,
    ...overrides
  }) as KeyboardEvent;

describe('Discord shortcut matching', () => {
  const cases = [
    ['KeyM', true, true, false, 'mute'],
    ['KeyD', true, true, false, 'deafen'],
    ['Comma', true, false, false, 'settings'],
    ['KeyK', true, false, false, 'search'],
    ['KeyF', true, true, false, 'search'],
    ['KeyU', true, false, false, 'members'],
    ['ArrowUp', false, false, true, 'previousChannel'],
    ['ArrowDown', false, false, true, 'nextChannel'],
    ['KeyV', true, true, true, 'voiceChannel'],
    ['Slash', true, false, false, 'help']
  ] as const;

  for (const [code, primary, shiftKey, altKey, action] of cases) {
    test(`${action} matches the Discord combination on Windows, Linux and macOS`, () => {
      for (const modifier of ['ctrlKey', 'metaKey']) {
        const shortcut = getShortcut(
          keyEvent({ code, shiftKey, altKey, [modifier]: primary })
        );
        expect(shortcut?.action).toBe(action);
      }
    });
  }

  test('AltGraph never triggers application shortcuts', () => {
    const event = keyEvent({
      code: 'KeyM',
      ctrlKey: true,
      shiftKey: true,
      getModifierState: (key) => key === 'AltGraph'
    });
    expect(getShortcut(event)).toBeUndefined();
  });

  test('plain typing and text-formatting shortcuts remain available', () => {
    for (const code of ['KeyM', 'KeyD', 'KeyK', 'KeyV', 'Slash', 'Comma']) {
      expect(getShortcut(keyEvent({ code }))).toBeUndefined();
    }
    for (const code of ['KeyB', 'KeyI', 'KeyE', 'KeyF']) {
      expect(getShortcut(keyEvent({ code, ctrlKey: true }))).toBeUndefined();
    }
  });
});

describe('custom shortcut preferences', () => {
  test('a custom binding replaces its default and disabled bindings never match', () => {
    const bindings = resolveShortcutBindings({
      mute: { code: 'KeyG', modifiers: ['Mod', 'Shift'] },
      deafen: null
    });
    expect(
      getShortcut(
        keyEvent({ code: 'KeyG', ctrlKey: true, shiftKey: true }),
        bindings
      )?.action
    ).toBe('mute');
    expect(
      getShortcut(
        keyEvent({ code: 'KeyM', ctrlKey: true, shiftKey: true }),
        bindings
      )
    ).toBeUndefined();
    expect(
      getShortcut(
        keyEvent({ code: 'KeyD', ctrlKey: true, shiftKey: true }),
        bindings
      )
    ).toBeUndefined();
    expect(
      getShortcut(
        keyEvent({ code: 'KeyF', ctrlKey: true, shiftKey: true }),
        bindings
      )?.id
    ).toBe('searchAlternative');
  });

  test('malformed or reserved saved data cannot replace working defaults', () => {
    const overrides = normalizeShortcutOverrides({
      mute: { code: 'KeyG', modifiers: ['Shift', 'Mod'] },
      deafen: null,
      settings: { code: 'F5', modifiers: ['Mod'] },
      members: { code: 'KeyM', modifiers: ['Unknown'] },
      search: { code: 'KeyK', modifiers: ['Mod', 'Mod'] },
      unknown: null
    });
    expect(overrides).toEqual({
      mute: { code: 'KeyG', modifiers: ['Mod', 'Shift'] },
      deafen: null
    });
    expect(normalizeShortcutOverrides(null)).toEqual({});
    expect(normalizeShortcutOverrides([])).toEqual({});
  });

  test('persisted collisions cannot silently shadow another action or its default', () => {
    const overrides = normalizeShortcutOverrides({
      mute: { code: 'KeyD', modifiers: ['Mod', 'Shift'] }
    });
    expect(overrides).toEqual({});
    expect(
      validateShortcutBinding(
        'mute',
        { code: 'KeyD', modifiers: ['Shift', 'Mod'] },
        resolveShortcutBindings({})
      )
    ).toEqual({
      type: 'duplicate',
      conflictingId: 'deafen'
    });
  });

  test('valid saved swaps survive while cascading default collisions are discarded', () => {
    expect(
      normalizeShortcutOverrides({
        mute: { code: 'KeyD', modifiers: ['Mod', 'Shift'] },
        deafen: { code: 'KeyM', modifiers: ['Mod', 'Shift'] }
      })
    ).toEqual({
      mute: { code: 'KeyD', modifiers: ['Mod', 'Shift'] },
      deafen: { code: 'KeyM', modifiers: ['Mod', 'Shift'] }
    });
    expect(
      normalizeShortcutOverrides({
        mute: { code: 'KeyD', modifiers: ['Mod', 'Shift'] },
        deafen: { code: 'KeyF', modifiers: ['Mod', 'Shift'] }
      })
    ).toEqual({});
  });

  test('unsafe browser, editing and debug combinations are rejected', () => {
    for (const binding of [
      { code: 'KeyR', modifiers: ['Mod'] as const },
      { code: 'KeyV', modifiers: ['Mod'] as const },
      { code: 'KeyB', modifiers: ['Mod'] as const },
      { code: 'ArrowLeft', modifiers: ['Mod'] as const },
      { code: 'F4', modifiers: ['Alt'] as const },
      { code: 'F5', modifiers: ['Mod'] as const },
      { code: 'F9', modifiers: ['Mod'] as const },
      { code: 'KeyJ', modifiers: [] as const }
    ]) {
      expect(
        validateShortcutBinding('mute', binding, resolveShortcutBindings({}))
          ?.type
      ).toBe('reserved');
    }
  });

  test('recording suppresses dispatch and keeps the captured event suppressed after cleanup', () => {
    const finish = beginShortcutRecording();
    const event = keyEvent({ code: 'KeyM', ctrlKey: true, shiftKey: true });
    try {
      expect(getShortcut(event)).toBeUndefined();
      expect(captureShortcut(event)).toEqual({
        binding: { code: 'KeyM', modifiers: ['Mod', 'Shift'] }
      });
      expect(isShortcutRecording(keyEvent({ code: 'F4' }))).toBe(true);
    } finally {
      finish();
    }
    expect(isShortcutRecording(event)).toBe(true);
    expect(getShortcut(event)).toBeUndefined();
    expect(
      getShortcut(keyEvent({ code: 'KeyM', ctrlKey: true, shiftKey: true }))
        ?.action
    ).toBe('mute');
  });

  test('one recorder cleanup cannot release a second active recording session', () => {
    const finishFirst = beginShortcutRecording();
    const finishSecond = beginShortcutRecording();
    try {
      finishFirst();
      finishFirst();
      expect(
        getShortcut(keyEvent({ code: 'KeyM', ctrlKey: true, shiftKey: true }))
      ).toBeUndefined();
    } finally {
      finishFirst();
      finishSecond();
    }
    expect(isShortcutRecording()).toBe(false);
  });

  test('capture ignores modifier-only, repeated, IME and AltGraph keydowns', () => {
    for (const event of [
      keyEvent({ code: 'ControlLeft', ctrlKey: true }),
      keyEvent({ code: 'KeyJ', ctrlKey: true, repeat: true }),
      keyEvent({ code: 'KeyJ', ctrlKey: true, isComposing: true }),
      keyEvent({ code: 'KeyJ', ctrlKey: true, metaKey: true }),
      keyEvent({ code: 'KeyJ', ctrlKey: true, getModifierState: () => true })
    ]) {
      expect(captureShortcut(event)).toEqual({ ignored: true });
      expect(getShortcut(event)).toBeUndefined();
    }
  });

  test('formatting follows physical codes and the effective modifiers', () => {
    expect(formatShortcut({ code: 'Comma', modifiers: ['Mod'] })).toBe(
      'Ctrl+,'
    );
    expect(
      formatShortcut({ code: 'KeyJ', modifiers: ['Mod', 'Shift'] }, true)
    ).toBe('⌘+Shift+J');
    expect(formatShortcut(null)).toBe('');
  });
});
