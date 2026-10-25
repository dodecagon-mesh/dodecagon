import { Dialog } from '@/components/dialogs/dialogs';
import {
  setModifierKeysHeldMap,
  togglePluginSlotDebug
} from '@/features/app/actions';
import { toggleDialog } from '@/features/dialogs/actions';
import { memo, useCallback, useEffect } from 'react';
import { isShortcutRecording } from './shortcuts';

const HotkeysController = memo(() => {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    setModifierKeysHeldMap({
      Shift: e.shiftKey,
      Control: e.ctrlKey,
      Alt: e.altKey
    });
    if (isShortcutRecording(e)) return;

    if (e.key === 'F4') {
      togglePluginSlotDebug();
    }

    if (e.key === 'F9') {
      e.preventDefault();
      toggleDialog(Dialog.VOICE_DEBUG);
    }

    if (e.key === 'Alt') {
      e.preventDefault();
    }
  }, []);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    setModifierKeysHeldMap({
      Shift: e.shiftKey,
      Control: e.ctrlKey,
      Alt: e.altKey
    });
  }, []);

  const handleBlur = useCallback(() => {
    setModifierKeysHeldMap({
      Shift: false,
      Control: false,
      Alt: false
    });
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [handleKeyDown, handleKeyUp, handleBlur]);
  return null;
});

export { HotkeysController };
