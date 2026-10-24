import { useDevices } from '@/components/devices-provider/hooks/use-devices';
import { useDemoVisibility } from '@/components/voice-provider/demo-visibility-context';
import { useChannelById } from '@/features/server/channels/hooks';
import { useVoiceUsersByChannelId } from '@/features/server/hooks';
import { useOwnUserId } from '@/features/server/users/hooks';
import {
  useHideNonVideoParticipants,
  useHideOwnScreenShare,
  useVoiceChannelExternalStreamsList
} from '@/features/server/voice/hooks';
import { memo, useCallback, useMemo, useState } from 'react';
import { ControlsBar } from './controls-bar';
import { ExternalStreamCard } from './external-stream-card';
import { useMouseActivity } from './hooks/use-mouse-activity';
import { usePinCardController } from './hooks/use-pin-card-controller';
import { ScreenShareCard } from './screen-share-card';
import { VoiceGrid } from './voice-grid';
import { VoiceStageActions } from './voice-stage-actions';
import { VoiceUserCard } from './voice-user-card';

type TChannelProps = {
  channelId: number;
};

const VoiceChannel = memo(({ channelId }: TChannelProps) => {
  const channel = useChannelById(channelId);
  const voiceUsers = useVoiceUsersByChannelId(channelId);
  const externalStreams = useVoiceChannelExternalStreamsList(channelId);
  const { pinnedCard, pinCard, unpinCard, isPinned } = usePinCardController();
  const hideNonVideoParticipants = useHideNonVideoParticipants();
  const hideOwnScreenShare = useHideOwnScreenShare();
  const ownUserId = useOwnUserId();
  const { viewedRemoteDemos } = useDemoVisibility();
  const { devices } = useDevices();
  const { isVisible: isChatButtonVisible, stageRef } = useMouseActivity();
  const isAnyCardPinned = pinnedCard !== undefined;
  const [participantsHidden, setParticipantsHidden] = useState(false);

  const handleToggleParticipants = useCallback(() => {
    setParticipantsHidden((hidden) => !hidden);
  }, []);

  const cards = useMemo(() => {
    const cards: React.ReactNode[] = [];

    // Check if there are any video streams at all
    const hasAnyVideoStreams =
      !devices.voiceOnlyMode &&
      (voiceUsers.some(
        (user) => user.state.webcamEnabled || user.state.sharingScreen
      ) ||
        externalStreams.some((stream) => stream.tracks.video));

    // Only apply the filter if there are some video streams
    const shouldFilterNonVideo = hideNonVideoParticipants && hasAnyVideoStreams;

    voiceUsers.forEach((voiceUser) => {
      const userCardId = `user-${voiceUser.id}`;
      const hasVideo = voiceUser.state.webcamEnabled;
      const needsDemoControl =
        voiceUser.id !== ownUserId &&
        voiceUser.state.sharingScreen &&
        !viewedRemoteDemos[voiceUser.id];

      // Keep the opt-in control reachable until its screen share tile is shown.
      if (!shouldFilterNonVideo || hasVideo || needsDemoControl) {
        cards.push(
          <VoiceUserCard
            key={userCardId}
            userId={voiceUser.id}
            channelId={channelId}
            isPinned={isPinned(userCardId)}
            isAnyCardPinned={isAnyCardPinned}
            cardId={userCardId}
            onPin={pinCard}
            onUnpin={unpinCard}
            voiceUser={voiceUser}
            // the speaking highlight follows the overlay chrome: it is gone
            // before the chat button and the call toolbar fade out
            showSpeakingOutline={isChatButtonVisible}
          />
        );
      }

      const shouldHideOwnScreenShare =
        hideOwnScreenShare && voiceUser.id === ownUserId;
      if (
        !devices.voiceOnlyMode &&
        voiceUser.state.sharingScreen &&
        !shouldHideOwnScreenShare
      ) {
        const screenShareCardId = `screen-share-${voiceUser.id}`;
        cards.push(
          <ScreenShareCard
            key={screenShareCardId}
            userId={voiceUser.id}
            isPinned={isPinned(screenShareCardId)}
            isAnyCardPinned={isAnyCardPinned}
            cardId={screenShareCardId}
            onPin={pinCard}
            onUnpin={unpinCard}
            showPinControls
          />
        );
      }
    });

    externalStreams.forEach((stream) => {
      if (devices.voiceOnlyMode) return;

      const externalStreamCardId = `external-stream-${stream.streamId}`;
      const hasVideo = stream.tracks.video;

      // Only show external stream card if not filtering, or if it has video
      if (!shouldFilterNonVideo || hasVideo) {
        cards.push(
          <ExternalStreamCard
            key={externalStreamCardId}
            streamId={stream.streamId}
            stream={stream}
            isPinned={isPinned(externalStreamCardId)}
            isAnyCardPinned={isAnyCardPinned}
            cardId={externalStreamCardId}
            onPin={pinCard}
            onUnpin={unpinCard}
            showPinControls
          />
        );
      }
    });

    return cards;
  }, [
    voiceUsers,
    externalStreams,
    devices.voiceOnlyMode,
    channelId,
    isPinned,
    pinCard,
    unpinCard,
    hideNonVideoParticipants,
    hideOwnScreenShare,
    ownUserId,
    viewedRemoteDemos,
    isAnyCardPinned,
    isChatButtonVisible
  ]);

  if (voiceUsers.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-rail">
        <div className="text-center">
          <p className="text-muted-foreground text-lg mb-2">
            No one in the voice channel
          </p>
          <p className="text-muted-foreground text-sm">
            Join the voice channel to start a meeting
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className="group/voice-stage relative flex size-full flex-col overflow-hidden bg-rail"
    >
      <VoiceStageActions
        channelId={channelId}
        channelName={channel?.name}
        isActive={isChatButtonVisible}
      />
      <div className="relative min-h-0 flex-1">
        <VoiceGrid
          pinnedCardId={pinnedCard?.id}
          tileAspectRatio={16 / 9}
          participantsHidden={participantsHidden}
          onToggleParticipants={handleToggleParticipants}
        >
          {cards}
        </VoiceGrid>
      </div>
      <ControlsBar channelId={channelId} isActive={isChatButtonVisible} />
    </div>
  );
});

export { VoiceChannel };
