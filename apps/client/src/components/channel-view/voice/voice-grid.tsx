import { cn } from '@/lib/utils';
import { isValidElement, memo, useMemo, type ReactNode } from 'react';
import { useContainerSize } from './hooks/use-container-size';
import { ParticipantsPill } from './participants-pill';

type TVoiceGridProps = {
  children: ReactNode[];
  pinnedCardId?: string;
  tileAspectRatio?: number;
  participantsHidden?: boolean;
  isPresentation?: boolean;
  presentationPreview?: ReactNode;
  onToggleParticipants?: () => void;
  className?: string;
};

const OPTIMAL_CELL_ASPECT_RATIO = 1.5;

const FOCUSED_AVATAR_CLASS = '[--voice-avatar-size:96px]';

const VoiceGrid = memo(
  ({
    children,
    pinnedCardId,
    tileAspectRatio,
    participantsHidden = false,
    isPresentation = false,
    presentationPreview,
    onToggleParticipants,
    className
  }: TVoiceGridProps) => {
    const { containerRef, containerSize } = useContainerSize();

    const calculateOptimalGrid = (
      totalCards: number,
      containerWidth: number,
      containerHeight: number
    ) => {
      if (totalCards <= 1 || containerWidth <= 0 || containerHeight <= 0) {
        return { cols: 1 };
      }

      const maxCols = totalCards;

      let bestCols = 1;
      let bestScore = Infinity;

      for (let cols = 1; cols <= maxCols; cols++) {
        const rows = Math.ceil(totalCards / cols);
        const cellWidth = containerWidth / cols;
        const cellHeight = containerHeight / rows;
        const cellAspectRatio = cellWidth / cellHeight;

        const score = Math.abs(cellAspectRatio - OPTIMAL_CELL_ASPECT_RATIO);
        if (score < bestScore) {
          bestScore = score;
          bestCols = cols;
        }
      }

      return { cols: bestCols };
    };

    const gridCols = useMemo(() => {
      const childArray = Array.isArray(children) ? children : [children];
      const totalCards = childArray.length;

      if (!containerSize) {
        return 1;
      }

      const { cols } = calculateOptimalGrid(
        totalCards,
        containerSize.width,
        containerSize.height
      );

      return cols;
    }, [children, containerSize]);

    const { pinnedCard, regularCards } = useMemo(() => {
      const childArray = Array.isArray(children) ? children : [children];

      if (pinnedCardId) {
        const pinned = childArray.find(
          (child: ReactNode) =>
            isValidElement(child) && child.key === pinnedCardId
        );

        const regular = childArray.filter(
          (child: ReactNode) =>
            !isValidElement(child) || child.key !== pinnedCardId
        );

        return { pinnedCard: pinned, regularCards: regular };
      }

      return { pinnedCard: null, regularCards: childArray };
    }, [children, pinnedCardId]);

    // focused media fills the stage; videos preserve their own aspect ratio
    let focusedCard = pinnedCard;
    const stripCards = pinnedCard ? regularCards : [];
    if (!focusedCard && regularCards.length === 1) {
      focusedCard = regularCards[0];
    }

    if (focusedCard) {
      const hasStrip = stripCards.length > 0;

      return (
        <div
          className={cn(
            'relative size-full min-h-0 bg-black',
            isPresentation && 'voice-presentation',
            (participantsHidden || !hasStrip) &&
              '[--voice-controls-clearance:66px]',
            className
          )}
        >
          <div
            className={cn(
              'voice-focused-media relative size-full [--voice-card-radius:0px] [--voice-card-border:0px] [--voice-caption-bottom:8px] [--voice-profile-tint:100%]',
              FOCUSED_AVATAR_CLASS
            )}
          >
            {focusedCard}
            <div className="voice-chrome pointer-events-none absolute inset-x-0 top-0 h-[104px] bg-linear-to-b from-black/35 to-transparent" />
            <div className="voice-chrome pointer-events-none absolute inset-x-0 bottom-10 h-[124px] bg-linear-to-t from-black/75 to-transparent" />
          </div>
          <div className="voice-chrome voice-chrome-interactive absolute inset-x-0 bottom-[82px] z-10 px-3">
            {hasStrip && (
              <div
                inert={participantsHidden}
                aria-hidden={participantsHidden}
                className={cn(
                  'flex h-[104px] shrink-0 justify-center-safe gap-2 overflow-x-auto',
                  'transition-[max-height,opacity] duration-200 ease-in-out motion-reduce:transition-none',
                  participantsHidden
                    ? 'max-h-0 opacity-0'
                    : 'max-h-[104px] opacity-100'
                )}
              >
                {presentationPreview && (
                  <div className="h-[104px] w-[187px] shrink-0">
                    {presentationPreview}
                  </div>
                )}
                {stripCards.map((card, index) => (
                  // compact thumbnails remain separate from the focused shell
                  <div key={index} className="h-[104px] w-[187px] shrink-0">
                    {card}
                  </div>
                ))}
              </div>
            )}
            {hasStrip && onToggleParticipants && (
              <ParticipantsPill
                hidden={participantsHidden}
                onToggle={onToggleParticipants}
              />
            )}
          </div>
        </div>
      );
    }

    const rows = Math.ceil(regularCards.length / gridCols);
    const lastRowCount = regularCards.length % gridCols || gridCols;
    const lastRowOffset =
      lastRowCount < gridCols ? ((gridCols - lastRowCount) / 2) * 100 : 0;
    const lastRowStart = regularCards.length - lastRowCount;

    const tileWidth =
      tileAspectRatio && containerSize
        ? Math.max(
            0,
            Math.min(
              (containerSize.width - 56 - (gridCols - 1) * 12) / gridCols,
              // the vertical padding of the grid below
              ((containerSize.height - 112 - (rows - 1) * 12) / rows) *
                tileAspectRatio
            )
          )
        : undefined;
    const tileHeight =
      tileWidth !== undefined && tileAspectRatio
        ? tileWidth / tileAspectRatio
        : undefined;

    return (
      <div
        ref={containerRef}
        className={cn(
          'grid size-full min-h-0 gap-3 bg-rail px-7 pt-4 pb-24',
          className
        )}
        style={{
          gridTemplateColumns: `repeat(${gridCols}, ${tileWidth !== undefined ? `${tileWidth}px` : '1fr'})`,
          gridTemplateRows: `repeat(${rows}, ${tileHeight !== undefined ? `${tileHeight}px` : '1fr'})`,
          alignContent: tileAspectRatio ? 'center' : undefined,
          justifyContent: tileAspectRatio ? 'center' : undefined
        }}
      >
        {regularCards.map((card, index) => (
          <div
            key={isValidElement(card) ? card.key : index}
            style={
              lastRowOffset && index >= lastRowStart
                ? { transform: `translateX(${lastRowOffset}%)` }
                : undefined
            }
          >
            {card}
          </div>
        ))}
      </div>
    );
  }
);

export { VoiceGrid };
