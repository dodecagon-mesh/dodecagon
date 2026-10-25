import { useScreenViewers } from '@/features/server/voice/hooks';
import { cn } from '@/lib/utils';
import { memo, useMemo } from 'react';
import {
  PinnedCardType,
  usePinCardController
} from './hooks/use-pin-card-controller';
import { StreamViewersList } from './stream-viewers-list';
import { VoiceChatButton } from './voice-chat-button';

type TVoiceStageActionsProps = {
  channelId: number;
  isActive: boolean;
};

const VoiceStageActions = memo(
  ({ channelId, isActive }: TVoiceStageActionsProps) => {
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
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end p-3 text-white">
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
