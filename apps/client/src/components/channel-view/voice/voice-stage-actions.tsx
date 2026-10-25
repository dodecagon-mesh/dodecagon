import { useScreenViewers } from '@/features/server/voice/hooks';
import { cn } from '@/lib/utils';
import { SpeakerWaveIcon } from '@heroicons/react/24/outline';
import { memo, useMemo } from 'react';
import {
  PinnedCardType,
  usePinCardController
} from './hooks/use-pin-card-controller';
import { StreamViewersList } from './stream-viewers-list';
import { VoiceChatButton } from './voice-chat-button';

type TVoiceStageActionsProps = {
  channelId: number;
  channelName?: string;
  isActive: boolean;
};

const VoiceStageActions = memo(
  ({ channelId, channelName, isActive }: TVoiceStageActionsProps) => {
    const { pinnedCard } = usePinCardController();
    const screenViewers = useScreenViewers(channelId);

    // the viewers list belongs to the demo that fills the stage
    const viewerIds = useMemo(() => {
      if (!pinnedCard || pinnedCard.type !== PinnedCardType.SCREEN_SHARE) {
        return undefined;
      }

      return screenViewers[pinnedCard.userId]?.viewerIds ?? [];
    }, [pinnedCard, screenViewers]);

    return (
      <div className="relative z-10 flex h-10 shrink-0 items-center justify-between gap-3 bg-black px-3 text-white">
        <div
          className={cn(
            'voice-chrome flex min-w-0 items-center gap-2',
            isActive ? 'opacity-100' : 'opacity-0'
          )}
        >
          <SpeakerWaveIcon
            aria-hidden="true"
            className="size-5 shrink-0 text-white/70"
          />
          <span className="truncate text-sm font-medium">{channelName}</span>
        </div>
        <div
          className={cn(
            'voice-chrome voice-chrome-interactive flex shrink-0 items-center gap-2 focus-within:pointer-events-auto focus-within:opacity-100 has-[[data-popup-open]]:opacity-100 has-[[aria-expanded=true]]:opacity-100',
            isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          {viewerIds && <StreamViewersList viewerIds={viewerIds} />}
          <VoiceChatButton channelId={channelId} />
        </div>
      </div>
    );
  }
);

VoiceStageActions.displayName = 'VoiceStageActions';

export { VoiceStageActions };
