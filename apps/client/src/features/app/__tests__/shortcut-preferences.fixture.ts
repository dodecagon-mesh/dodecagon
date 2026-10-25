// Isolate the real app store/actions from unrelated mock.module registrations.
import { getShortcut } from '@/components/hotkeys-controller/shortcuts';
import { setStoreState, store } from '@/features/store';
import { LocalStorageKey } from '@/helpers/storage';
import {
  resetAllShortcutBindings,
  resetShortcutBinding,
  setShortcutBinding
} from '../actions';
import { shortcutBindingsSelector } from '../selectors';
import {
  appInitialState,
  appSliceReducer,
  hydrateAppFromStorage
} from '../slice';

const items = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => items.get(key) ?? null,
  setItem: (key: string, value: string) => {
    items.set(key, value);
  },
  removeItem: (key: string) => {
    items.delete(key);
  }
} as Storage;
setStoreState({ app: appInitialState });

const customError = setShortcutBinding('mute', {
  code: 'KeyG',
  modifiers: ['Mod', 'Shift']
});
setShortcutBinding('deafen', null);
const saved = localStorage.getItem(LocalStorageKey.SHORTCUT_OVERRIDES);
const duplicateError = setShortcutBinding('members', {
  code: 'KeyG',
  modifiers: ['Mod', 'Shift']
});
const afterDuplicate = localStorage.getItem(LocalStorageKey.SHORTCUT_OVERRIDES);
const restored = appSliceReducer(appInitialState, hydrateAppFromStorage());
setStoreState({ app: restored });
const event = (code: string) =>
  ({
    code,
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    repeat: false,
    defaultPrevented: false,
    isComposing: false,
    getModifierState: () => false
  }) as unknown as KeyboardEvent;
const bindings = shortcutBindingsSelector(store.getState());
const customAction = getShortcut(event('KeyG'), bindings)?.action;
const oldAction = getShortcut(event('KeyM'), bindings)?.action;
const disabledAction = getShortcut(event('KeyD'), bindings)?.action;
resetShortcutBinding('mute');
const resetMute = store.getState().app.shortcutOverrides;
resetAllShortcutBindings();
const resetRestored = appSliceReducer(appInitialState, hydrateAppFromStorage());
localStorage.setItem(LocalStorageKey.SHORTCUT_OVERRIDES, '{broken');
const malformedRestored = appSliceReducer(
  appInitialState,
  hydrateAppFromStorage()
);
console.log(
  `__SHORTCUTS__${JSON.stringify({
    customError,
    saved,
    duplicateError,
    afterDuplicate,
    customAction,
    oldAction,
    disabledAction,
    resetMute,
    resetAll: resetRestored.shortcutOverrides,
    malformed: malformedRestored.shortcutOverrides
  })}`
);
