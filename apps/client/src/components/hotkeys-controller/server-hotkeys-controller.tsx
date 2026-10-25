import { Dialog } from '@/components/dialogs/dialogs';
import { ServerScreen } from '@/components/server-screens/screens';
import { shortcutBindingsSelector } from '@/features/app/selectors';
import { openDialog, toggleDialog } from '@/features/dialogs/actions';
import { dialogInfoSelector } from '@/features/dialogs/selectors';
import { openServerScreen } from '@/features/server-screens/actions';
import { serverScreensInfoSelector } from '@/features/server-screens/selectors';
import { setDmsOpen } from '@/features/server/actions';
import { useCurrentVoiceChannelId } from '@/features/server/channels/hooks';
import {
  currentVoiceChannelIdSelector,
  selectedChannelIdSelector
} from '@/features/server/channels/selectors';
import { useChannelCan } from '@/features/server/hooks';
import {
  navigableTextChannelsSelector,
  publicServerSettingsSelector
} from '@/features/server/selectors';
import { useVoice } from '@/features/server/voice/hooks';
import { store } from '@/features/store';
import { useSelectChannel } from '@/hooks/use-select-channel';
import { ChannelPermission, getTrpcError } from '@dodecagon/shared';
import { memo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getShortcut } from './shortcuts';

type TServerHotkeysControllerProps = {
  onToggleMembers: () => void;
};

const ServerHotkeysController = memo(
  ({ onToggleMembers }: TServerHotkeysControllerProps) => {
    const { t } = useTranslation('common');
    const { toggleMic, toggleSound, ownVoiceState } = useVoice();
    const currentVoiceChannelId = useCurrentVoiceChannelId();
    const channelCan = useChannelCan(currentVoiceChannelId);
    const selectChannel = useSelectChannel();

    const handleKeyDown = useCallback(
      async (event: KeyboardEvent) => {
        const state = store.getState();
        const shortcut = getShortcut(event, shortcutBindingsSelector(state));
        if (!shortcut) return;

        const isVoiceShortcut =
          shortcut.action === 'mute' || shortcut.action === 'deafen';
        const settings = publicServerSettingsSelector(state);
        if (shortcut.action === 'search' && !settings?.enableSearch) return;
        const dialog = dialogInfoSelector(state);
        const screen = serverScreensInfoSelector(state);
        const canToggleHelp =
          shortcut.action === 'help' &&
          (!dialog.isOpen || dialog.openDialog === Dialog.KEYBOARD_SHORTCUTS);
        if (
          !isVoiceShortcut &&
          !canToggleHelp &&
          (dialog.isOpen || screen.isOpen)
        )
          return;
        if (
          shortcut.action === 'members' &&
          event.target instanceof HTMLElement &&
          (event.target.isContentEditable ||
            event.target.closest('input, textarea, select'))
        )
          return;

        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (shortcut.action === 'help') {
          toggleDialog(Dialog.KEYBOARD_SHORTCUTS);
          return;
        }
        if (shortcut.action === 'settings') {
          openServerScreen(ServerScreen.USER_SETTINGS);
          return;
        }
        if (shortcut.action === 'search') {
          openDialog(Dialog.SEARCH);
          return;
        }
        if (shortcut.action === 'members') {
          onToggleMembers();
          return;
        }
        try {
          if (shortcut.action === 'voiceChannel') {
            const voiceChannelId = currentVoiceChannelIdSelector(state);
            if (voiceChannelId !== undefined) {
              setDmsOpen(false);
              await selectChannel(voiceChannelId);
            }
            return;
          }
          if (
            shortcut.action === 'previousChannel' ||
            shortcut.action === 'nextChannel'
          ) {
            const channels = navigableTextChannelsSelector(state);
            const selectedChannelId = selectedChannelIdSelector(state);
            const index = channels.findIndex(
              ({ id }) => id === selectedChannelId
            );
            const offset = shortcut.action === 'nextChannel' ? 1 : -1;
            let nextIndex = index + offset;
            if (index === -1)
              nextIndex = offset === 1 ? 0 : channels.length - 1;
            const nextChannel = channels[nextIndex];
            if (nextChannel) {
              setDmsOpen(false);
              await selectChannel(nextChannel.id);
            }
            return;
          }
          if (shortcut.action === 'deafen') {
            await toggleSound();
          } else if (
            shortcut.action === 'mute' &&
            channelCan(ChannelPermission.SPEAK) &&
            !ownVoiceState.soundMuted
          ) {
            await toggleMic();
          }
        } catch (error) {
          let message = t('failedExecuteCommand');
          if (shortcut.action === 'deafen')
            message = t('failedUpdateSoundState');
          if (shortcut.action === 'mute')
            message = t('failedUpdateMicrophoneState');
          toast.error(getTrpcError(error, message));
        }
      },
      [
        channelCan,
        ownVoiceState.soundMuted,
        toggleMic,
        toggleSound,
        selectChannel,
        onToggleMembers,
        t
      ]
    );

    useEffect(() => {
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [handleKeyDown]);

    return null;
  }
);

export { ServerHotkeysController };
