export type TShortcutId =
  | 'mute'
  | 'deafen'
  | 'settings'
  | 'search'
  | 'searchAlternative'
  | 'members'
  | 'previousChannel'
  | 'nextChannel'
  | 'help'
  | 'voiceChannel';

export type TShortcutBinding = {
  code: string;
  modifiers: readonly ('Mod' | 'Shift' | 'Alt')[];
};

export type TShortcut = TShortcutBinding & {
  id: TShortcutId;
  action: Exclude<TShortcutId, 'searchAlternative'>;
  label: `${'dialogs' | 'sidebar' | 'topbar'}:${string}`;
};

export type TShortcutOverrides = Partial<
  Record<TShortcutId, TShortcutBinding | null>
>;
export type TResolvedShortcut = Pick<TShortcut, 'id' | 'action' | 'label'> & {
  binding: TShortcutBinding | null;
};
export type TShortcutValidationError =
  | { type: 'duplicate'; conflictingId: TShortcutId }
  | { type: 'reserved' | 'unsupported' };

export const SHORTCUTS: readonly TShortcut[] = [
  {
    id: 'mute',
    action: 'mute',
    code: 'KeyM',
    modifiers: ['Mod', 'Shift'],
    label: 'dialogs:shortcutMute'
  },
  {
    id: 'deafen',
    action: 'deafen',
    code: 'KeyD',
    modifiers: ['Mod', 'Shift'],
    label: 'dialogs:shortcutDeafen'
  },
  {
    id: 'settings',
    action: 'settings',
    code: 'Comma',
    modifiers: ['Mod'],
    label: 'sidebar:userSettings'
  },
  {
    id: 'search',
    action: 'search',
    code: 'KeyK',
    modifiers: ['Mod'],
    label: 'topbar:searchContent'
  },
  {
    id: 'searchAlternative',
    action: 'search',
    code: 'KeyF',
    modifiers: ['Mod', 'Shift'],
    label: 'topbar:searchContent'
  },
  {
    id: 'members',
    action: 'members',
    code: 'KeyU',
    modifiers: ['Mod'],
    label: 'dialogs:shortcutMembers'
  },
  {
    id: 'previousChannel',
    action: 'previousChannel',
    code: 'ArrowUp',
    modifiers: ['Alt'],
    label: 'dialogs:shortcutPreviousChannel'
  },
  {
    id: 'nextChannel',
    action: 'nextChannel',
    code: 'ArrowDown',
    modifiers: ['Alt'],
    label: 'dialogs:shortcutNextChannel'
  },
  {
    id: 'voiceChannel',
    action: 'voiceChannel',
    code: 'KeyV',
    modifiers: ['Mod', 'Shift', 'Alt'],
    label: 'dialogs:shortcutBackToVoice'
  },
  {
    id: 'help',
    action: 'help',
    code: 'Slash',
    modifiers: ['Mod'],
    label: 'dialogs:keyboardShortcutsTitle'
  }
];

const MODIFIERS = ['Mod', 'Shift', 'Alt'] as const;
const SUPPORTED_CODE =
  /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-9]|2[0-4])|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Backquote|Minus|Equal|Space|Enter|Tab|Escape|Backspace|Delete)$/;

const isBinding = (value: unknown): value is TShortcutBinding => {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Partial<TShortcutBinding>;
  return (
    typeof binding.code === 'string' &&
    SUPPORTED_CODE.test(binding.code) &&
    Array.isArray(binding.modifiers) &&
    binding.modifiers.every((modifier) => MODIFIERS.includes(modifier)) &&
    new Set(binding.modifiers).size === binding.modifiers.length
  );
};

const sameBinding = (a: TShortcutBinding, b: TShortcutBinding) =>
  a.code === b.code &&
  MODIFIERS.every(
    (modifier) =>
      a.modifiers.includes(modifier) === b.modifiers.includes(modifier)
  );

const bindingError = (
  binding: TShortcutBinding
): TShortcutValidationError | undefined => {
  if (!isBinding(binding)) return { type: 'unsupported' };
  const mod = binding.modifiers.includes('Mod');
  const alt = binding.modifiers.includes('Alt');
  const shift = binding.modifiers.includes('Shift');
  // Keep editing, browser/OS navigation, reload and the app's debug keys available.
  if (
    (!mod && !alt) ||
    [
      'F4',
      'F5',
      'F9',
      'F11',
      'F12',
      'Escape',
      'Tab',
      'Enter',
      'Space',
      'Backspace',
      'Delete'
    ].includes(binding.code) ||
    (mod &&
      !alt &&
      [
        'KeyR',
        'KeyW',
        'KeyT',
        'KeyN',
        'KeyL',
        'KeyQ',
        'KeyP',
        'KeyO',
        'KeyS',
        'Minus',
        'Equal',
        'Digit0'
      ].includes(binding.code)) ||
    (mod &&
      !alt &&
      !shift &&
      [
        'KeyA',
        'KeyB',
        'KeyC',
        'KeyE',
        'KeyI',
        'KeyX',
        'KeyV',
        'KeyZ',
        'KeyY',
        'Home',
        'End',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown'
      ].includes(binding.code)) ||
    (mod &&
      !alt &&
      shift &&
      ['KeyC', 'KeyV', 'KeyZ', 'KeyI', 'KeyJ'].includes(binding.code)) ||
    (alt &&
      !mod &&
      ['ArrowLeft', 'ArrowRight', 'Home', 'Space'].includes(binding.code))
  )
    return { type: 'reserved' };
};

export const resolveShortcutBindings = (
  overrides: TShortcutOverrides
): TResolvedShortcut[] =>
  SHORTCUTS.map(({ id, action, label, code, modifiers }) => ({
    id,
    action,
    label,
    binding: Object.hasOwn(overrides, id)
      ? (overrides[id] ?? null)
      : { code, modifiers }
  }));

export const validateShortcutBinding = (
  id: TShortcutId,
  binding: TShortcutBinding | null,
  bindings: readonly TResolvedShortcut[]
): TShortcutValidationError | undefined => {
  if (binding === null) return;
  const error = bindingError(binding);
  if (error) return error;
  if (
    id !== 'members' &&
    binding.code === 'KeyU' &&
    binding.modifiers.includes('Mod') &&
    !binding.modifiers.includes('Shift') &&
    !binding.modifiers.includes('Alt')
  )
    return { type: 'reserved' };
  const conflict = bindings.find(
    (shortcut) =>
      shortcut.id !== id &&
      shortcut.binding !== null &&
      sameBinding(shortcut.binding, binding)
  );
  if (conflict) return { type: 'duplicate', conflictingId: conflict.id };
};

export const normalizeShortcutOverrides = (
  value: unknown
): TShortcutOverrides => {
  const overrides: TShortcutOverrides = {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return overrides;
  for (const shortcut of SHORTCUTS) {
    if (!Object.hasOwn(value, shortcut.id)) continue;
    const candidate = (value as Record<string, unknown>)[shortcut.id];
    if (candidate === null) {
      overrides[shortcut.id] = null;
    } else if (
      isBinding(candidate) &&
      !bindingError(candidate) &&
      !sameBinding(shortcut, candidate)
    ) {
      overrides[shortcut.id] = {
        code: candidate.code,
        modifiers: MODIFIERS.filter((modifier) =>
          candidate.modifiers.includes(modifier)
        )
      };
    }
  }
  // Reject every colliding custom entry, then check again: restoring one default
  // can expose a second collision. Disabled entries and valid swaps are retained.
  let changed: boolean;
  do {
    changed = false;
    const bindings = resolveShortcutBindings(overrides);
    for (const shortcut of bindings) {
      if (
        overrides[shortcut.id] &&
        validateShortcutBinding(shortcut.id, shortcut.binding, bindings)
      ) {
        delete overrides[shortcut.id];
        changed = true;
      }
    }
  } while (changed);
  return overrides;
};

const recordingSessions = new Set<symbol>();
const recordingEvents = new WeakSet<KeyboardEvent>();
const markRecordingEvent = (event: KeyboardEvent) => {
  if (recordingSessions.size) recordingEvents.add(event);
};

export const beginShortcutRecording = () => {
  const session = Symbol('shortcut-recording');
  recordingSessions.add(session);
  if (recordingSessions.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('keydown', markRecordingEvent, true);
  }
  return () => {
    recordingSessions.delete(session);
    if (!recordingSessions.size && typeof window !== 'undefined') {
      window.removeEventListener('keydown', markRecordingEvent, true);
    }
  };
};

export const isShortcutRecording = (event?: KeyboardEvent) =>
  recordingSessions.size > 0 ||
  (event !== undefined && recordingEvents.has(event));

const ignoreKeyboardEvent = (event: KeyboardEvent) =>
  event.isComposing ||
  (event.ctrlKey && event.metaKey) ||
  event.getModifierState('AltGraph');

export const captureShortcut = (
  event: KeyboardEvent
):
  | { binding: TShortcutBinding }
  | { error: 'reserved' | 'unsupported' }
  | { ignored: true } => {
  recordingEvents.add(event);
  if (
    ignoreKeyboardEvent(event) ||
    event.repeat ||
    /^(Control|Meta|Shift|Alt)(Left|Right)$/.test(event.code)
  )
    return { ignored: true };
  const binding: TShortcutBinding = {
    code: event.code,
    modifiers: MODIFIERS.filter((modifier) =>
      modifier === 'Mod'
        ? event.ctrlKey || event.metaKey
        : modifier === 'Shift'
          ? event.shiftKey
          : event.altKey
    )
  };
  const error = bindingError(binding);
  if (error)
    return { error: error.type === 'reserved' ? 'reserved' : 'unsupported' };
  return { binding };
};

const DEFAULT_BINDINGS = resolveShortcutBindings({});

export const getShortcut = (
  event: KeyboardEvent,
  bindings: readonly TResolvedShortcut[] = DEFAULT_BINDINGS
) => {
  if (
    event.defaultPrevented ||
    isShortcutRecording(event) ||
    ignoreKeyboardEvent(event)
  )
    return;
  return bindings.find(
    ({ binding }) =>
      binding !== null &&
      event.code === binding.code &&
      (event.ctrlKey || event.metaKey) === binding.modifiers.includes('Mod') &&
      event.shiftKey === binding.modifiers.includes('Shift') &&
      event.altKey === binding.modifiers.includes('Alt')
  );
};

const KEY_LABELS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→'
};

export const formatShortcut = (
  binding: TShortcutBinding | null,
  mac = false
): string => {
  if (!binding) return '';
  const key =
    KEY_LABELS[binding.code] ?? binding.code.replace(/^(Key|Digit)/, '');
  return [
    ...MODIFIERS.filter((modifier) => binding.modifiers.includes(modifier)).map(
      (modifier) => (modifier === 'Mod' ? (mac ? '⌘' : 'Ctrl') : modifier)
    ),
    key
  ].join('+');
};
