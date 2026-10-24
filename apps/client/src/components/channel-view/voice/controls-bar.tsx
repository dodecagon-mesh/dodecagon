import { AudioSettingsMenu } from '@/components/audio-settings-menu';
import { useDevices } from '@/components/devices-provider/hooks/use-devices';
import { Protect } from '@/components/protect';
import { useIsCurrentVoiceChannelSelected } from '@/features/server/channels/hooks';
import { useChannelCan } from '@/features/server/hooks';
import { leaveVoice } from '@/features/server/voice/actions';
import { useOwnVoiceState, useVoice } from '@/features/server/voice/hooks';
import { cn } from '@/lib/utils';
import { ChannelPermission, Permission } from '@dodecagon/shared';
import {
  Button,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicOffIcon,
  Tooltip
} from '@dodecagon/ui';
import {
  ComputerDesktopIcon,
  MicrophoneIcon,
  PhoneXMarkIcon,
  VideoCameraIcon,
  VideoCameraSlashIcon
} from '@heroicons/react/24/outline';
import { memo, useCallback, useMemo } from 'react';
import { ControlToggleButton } from './control-toggle-button';
import { ReactionsButton } from './reactions-button';

type TControlsBarProps = {
  channelId: number;
  isActive: boolean;
};

const ControlsBar = memo(({ channelId, isActive }: TControlsBarProps) => {
  const {
    toggleMic,
    toggleSound,
    toggleWebcam,
    toggleScreenShare,
    isScreenShareSupported
  } = useVoice();
  const ownVoiceState = useOwnVoiceState();
  const { devices } = useDevices();
  const channelCan = useChannelCan(channelId);
  const isConnectedToThisChannel = useIsCurrentVoiceChannelSelected();

  const permissions = useMemo(
    () => ({
      canSpeak: channelCan(ChannelPermission.SPEAK),
      canWebcam: channelCan(ChannelPermission.WEBCAM),
      canShareScreen: channelCan(ChannelPermission.SHARE_SCREEN)
    }),
    [channelCan]
  );

  // tooltip composition can override the reaction popover's data-state.
  const barClass = cn(
    'focus-within:opacity-100 has-[[data-popup-open]]:opacity-100 has-[[aria-expanded=true]]:opacity-100',
    isActive ? 'opacity-100' : 'opacity-0'
  );

  const handleLeaveVoice = useCallback(() => {
    leaveVoice();
  }, []);

  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-3 z-20 flex min-h-[50px] items-center justify-center gap-3 px-2 pointer-events-none sm:px-4 max-[360px]:gap-1 max-[360px]:px-1',
        barClass
      )}
    >
      <div
        data-voice-controls
        className={cn(
          'flex items-center gap-3 max-[360px]:gap-1 focus-within:pointer-events-auto has-[[data-popup-open]]:pointer-events-auto has-[[aria-expanded=true]]:pointer-events-auto',
          isActive ? 'pointer-events-auto' : 'pointer-events-none'
        )}
      >
        <div
          className={cn(
            'flex items-center gap-1 rounded-[12px] bg-black p-[5px] focus-within:pointer-events-auto has-[[data-popup-open]]:pointer-events-auto has-[[aria-expanded=true]]:pointer-events-auto',
            isActive ? 'pointer-events-auto' : 'pointer-events-none'
          )}
        >
          <AudioSettingsMenu kind="microphone">
            <ControlToggleButton
              enabled={ownVoiceState.micMuted}
              enabledLabel="Unmute"
              disabledLabel="Mute"
              enabledIcon={MicOffIcon}
              disabledIcon={MicrophoneIcon}
              enabledClassName="bg-destructive/20 text-destructive hover:bg-destructive/30 hover:text-destructive"
              onClick={toggleMic}
              disabled={!permissions.canSpeak || ownVoiceState.soundMuted}
              keepFocusableWhenDisabled
            />
          </AudioSettingsMenu>
          <ControlToggleButton
            enabled={ownVoiceState.webcamEnabled}
            enabledLabel="Stop Video"
            disabledLabel="Start Video"
            enabledIcon={VideoCameraIcon}
            disabledIcon={VideoCameraSlashIcon}
            enabledClassName="bg-success-solid text-white hover:bg-success-solid/90 hover:text-white"
            onClick={toggleWebcam}
            disabled={!permissions.canWebcam || devices.voiceOnlyMode}
          />
        </div>
        <div
          className={cn(
            'flex items-center gap-1 rounded-[12px] bg-black p-[5px] focus-within:pointer-events-auto has-[[data-popup-open]]:pointer-events-auto has-[[aria-expanded=true]]:pointer-events-auto',
            isActive ? 'pointer-events-auto' : 'pointer-events-none'
          )}
        >
          {isScreenShareSupported && (
            <ControlToggleButton
              enabled={ownVoiceState.sharingScreen}
              enabledLabel="Stop Sharing"
              disabledLabel="Share Screen"
              enabledIcon={ComputerDesktopIcon}
              disabledIcon={ComputerDesktopIcon}
              enabledClassName="bg-success-solid text-white hover:bg-success-solid/90 hover:text-white"
              onClick={toggleScreenShare}
              disabled={!permissions.canShareScreen || devices.voiceOnlyMode}
            />
          )}

          {isConnectedToThisChannel && (
            <Protect permission={Permission.SEND_VOICE_REACTION}>
              <ReactionsButton />
            </Protect>
          )}
          <AudioSettingsMenu kind="output">
            <ControlToggleButton
              enabled={ownVoiceState.soundMuted}
              enabledLabel="Undeafen"
              disabledLabel="Deafen"
              enabledIcon={HeadphonesOffIcon}
              disabledIcon={HeadphonesIcon}
              enabledClassName="bg-destructive/20 text-destructive hover:bg-destructive/30 hover:text-destructive"
              onClick={toggleSound}
            />
          </AudioSettingsMenu>
        </div>
        <div
          className={cn(
            'focus-within:pointer-events-auto',
            isActive ? 'pointer-events-auto' : 'pointer-events-none'
          )}
        >
          <Tooltip content="Disconnect">
            <Button
              variant="destructive"
              className="h-[50px] w-16 rounded-[12px] p-0"
              onClick={handleLeaveVoice}
              aria-label="Disconnect"
            >
              <PhoneXMarkIcon className="size-5" />
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
});

export { ControlsBar };
