import { Dialog } from '@/components/dialogs/dialogs';
import { store } from '../store';
import { overlaySelector } from './selectors';
import { overlaySliceActions, type TOverlayInput } from './slice';

export const openOverlay = (overlay: TOverlayInput) => {
  store.dispatch(overlaySliceActions.openOverlay(overlay));
};

export const closeOverlay = () => {
  store.dispatch(overlaySliceActions.closeOverlay());
};

export const toggleDialog = (dialog: Dialog) => {
  const overlay = overlaySelector(store.getState());

  if (overlay?.kind === 'dialog' && overlay.name === dialog) {
    closeOverlay();

    return;
  }

  openOverlay({ kind: 'dialog', name: dialog });
};

export const requestConfirmation = async ({
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'info',
  onConfirm,
  onCancel
}: {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'info';
  onConfirm?: () => void;
  onCancel?: () => void;
}): Promise<boolean> => {
  const { promise, resolve } = Promise.withResolvers<boolean>();

  openOverlay({
    kind: 'dialog',
    name: Dialog.CONFIRM_ACTION,
    props: {
      title,
      message,
      confirmLabel,
      cancelLabel,
      variant,
      onConfirm: () => {
        onConfirm?.();
        closeOverlay();
        resolve(true);
      },
      onCancel: () => {
        onCancel?.();
        closeOverlay();
        resolve(false);
      }
    }
  });

  return promise;
};

export const requestTextInput = async ({
  title,
  message,
  confirmLabel,
  cancelLabel,
  type = 'text',
  allowEmpty = false,
  autoClose = true
}: {
  title?: string;
  message?: string;
  type?: 'text' | 'password';
  confirmLabel?: string;
  cancelLabel?: string;
  allowEmpty?: boolean;
  autoClose?: boolean;
}): Promise<string | undefined | null> => {
  const { promise, resolve } = Promise.withResolvers<
    string | undefined | null
  >();

  openOverlay({
    kind: 'dialog',
    name: Dialog.TEXT_INPUT,
    props: {
      title,
      message,
      confirmLabel,
      cancelLabel,
      allowEmpty,
      type,
      onConfirm: (text: string) => {
        if (autoClose) {
          closeOverlay();
        }

        resolve(text);
      },
      onCancel: () => {
        resolve(null);
      }
    }
  });

  return promise;
};
