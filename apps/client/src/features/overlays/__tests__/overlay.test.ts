import { Dialog } from '@/components/dialogs/dialogs';
import { ServerScreen } from '@/components/server-screens/screens';
import { describe, expect, test } from 'bun:test';
import { createStore } from '../../store';
import { overlaySelector } from '../selectors';
import { overlaySliceActions } from '../slice';

describe('the overlay holder', () => {
  test('replaces an open dialog when a server screen opens', () => {
    const store = createStore();

    store.dispatch(
      overlaySliceActions.openOverlay({ kind: 'dialog', name: Dialog.SEARCH })
    );
    store.dispatch(
      overlaySliceActions.openOverlay({
        kind: 'serverScreen',
        name: ServerScreen.USER_SETTINGS,
        props: { initialEntryId: 'devices' }
      })
    );

    expect(overlaySelector(store.getState())).toEqual({
      kind: 'serverScreen',
      name: ServerScreen.USER_SETTINGS,
      props: { initialEntryId: 'devices' }
    });
  });

  test('replaces an open server screen when a dialog opens', () => {
    const store = createStore();

    store.dispatch(
      overlaySliceActions.openOverlay({
        kind: 'serverScreen',
        name: ServerScreen.SERVER_SETTINGS
      })
    );
    store.dispatch(
      overlaySliceActions.openOverlay({
        kind: 'dialog',
        name: Dialog.CREATE_CHANNEL,
        props: { categoryId: 1 }
      })
    );

    expect(overlaySelector(store.getState())).toEqual({
      kind: 'dialog',
      name: Dialog.CREATE_CHANNEL,
      props: { categoryId: 1 }
    });
  });

  test('closes the open overlay', () => {
    const store = createStore();

    store.dispatch(
      overlaySliceActions.openOverlay({
        kind: 'dialog',
        name: Dialog.CONFIRM_ACTION
      })
    );
    store.dispatch(overlaySliceActions.closeOverlay());

    expect(overlaySelector(store.getState())).toBeUndefined();
  });
});
