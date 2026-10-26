import type { Dialog } from '@/components/dialogs/dialogs';
import type { ServerScreen } from '@/components/server-screens/screens';
import type { TGenericObject } from '@dodecagon/shared';

// a dialog and a server screen are never open at the same time, so one entry
// replaces the other instead of stacking
export type TOverlay =
  | { kind: 'dialog'; name: Dialog; props: TGenericObject }
  | { kind: 'serverScreen'; name: ServerScreen; props: TGenericObject };

export type TOverlayInput =
  | {
      kind: 'dialog';
      name: Dialog;
      props?: TGenericObject;
    }
  | {
      kind: 'serverScreen';
      name: ServerScreen;
      props?: TGenericObject;
    };

export type TOverlayState = TOverlay | undefined;

export type TOverlayAction =
  | { type: 'overlay/openOverlay'; payload: TOverlayInput }
  | { type: 'overlay/closeOverlay' };

const initialState: TOverlayState = undefined;

const overlaySliceActions = {
  openOverlay: (overlay: TOverlayInput): TOverlayAction => ({
    type: 'overlay/openOverlay',
    payload: overlay
  }),
  closeOverlay: (): TOverlayAction => ({ type: 'overlay/closeOverlay' })
};

const overlaySliceReducer = (
  state: TOverlayState,
  action: TOverlayAction
): TOverlayState => {
  if (action.type === 'overlay/openOverlay') {
    const { kind, name, props } = action.payload;

    if (kind === 'dialog') {
      return { kind, name, props: props ?? {} };
    }

    return { kind, name, props: props ?? {} };
  }

  if (action.type === 'overlay/closeOverlay') {
    return undefined;
  }

  return state;
};

export {
  initialState as overlayInitialState,
  overlaySliceActions,
  overlaySliceReducer
};
