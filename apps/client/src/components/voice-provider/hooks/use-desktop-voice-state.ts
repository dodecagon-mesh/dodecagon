import { useEffect } from 'react';

type TVoiceTrayState = {
  connected: boolean;
  micMuted: boolean;
  soundMuted: boolean;
};

type TDesktopVoiceBridge = {
  setVoiceState?: (state: TVoiceTrayState) => Promise<void>;
};

const publishVoiceState = async (state: TVoiceTrayState) => {
  const desktop = (
    globalThis as typeof globalThis & {
      dodecagonDesktop?: TDesktopVoiceBridge;
    }
  ).dodecagonDesktop;
  try {
    await desktop?.setVoiceState?.(state);
  } catch (error) {
    console.warn('Unable to update desktop tray', error);
  }
};

export const useDesktopVoiceState = (
  connected: boolean,
  micMuted: boolean,
  soundMuted: boolean
) => {
  useEffect(() => {
    void publishVoiceState({ connected, micMuted, soundMuted });
  }, [connected, micMuted, soundMuted]);

  useEffect(
    () => () => {
      void publishVoiceState({
        connected: false,
        micMuted: false,
        soundMuted: false
      });
    },
    []
  );
};
