import { cn } from '@/lib/utils';
import { isValidElement, memo, useMemo, type ReactNode } from 'react';
import { useContainerSize } from './hooks/use-container-size';
import { ParticipantsPill } from './participants-pill';

type TVoiceGridProps = {
  children: ReactNode[];
  pinnedCardId?: string;
  tileAspectRatio?: number;
  participantsHidden?: boolean;
  onToggleParticipants?: () => void;
  className?: string;
};

const OPTIMAL_CELL_ASPECT_RATIO = 1.5;

// the focused tile shows a bigger avatar than the tiles of the grid, the
// value is read by the participant card
const FOCUSED_AVATAR_CLASS = '[--voice-avatar-size:160px]';

// the focused tile keeps a margin around it, so it never touches the edges
// of the stage
const FOCUSED_TILE_MARGIN = 32;

const VoiceGrid = memo(
  ({
    children,
    pinnedCardId,
    tileAspectRatio,
    participantsHidden = false,
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

    // a pinned card and a lone participant share the focused stage: the tile
    // keeps its shape in the middle of the stage and the other participants
    // stay below it
    let focusedCard = pinnedCard;
    const stripCards = pinnedCard ? regularCards : [];
    if (!focusedCard && regularCards.length === 1) {
      focusedCard = regularCards[0];
    }

    if (focusedCard) {
      const ratio = tileAspectRatio ?? 16 / 9;
      const focusedWidth = containerSize
        ? Math.max(
            0,
            Math.min(
              containerSize.width - FOCUSED_TILE_MARGIN * 2,
              (containerSize.height - FOCUSED_TILE_MARGIN * 2) * ratio
            )
          )
        : undefined;
      const focusedHeight =
        focusedWidth !== undefined ? focusedWidth / ratio : undefined;

      return (
        <div
          className={cn(
            // the top band keeps the stage actions clear of the focused tile
            'flex h-full flex-col gap-3 bg-rail px-7 pt-14 pb-3',
            className
          )}
        >
          <div
            ref={containerRef}
            className="relative flex min-h-0 flex-1 items-center justify-center"
          >
            <div
              className={cn('relative shrink-0', FOCUSED_AVATAR_CLASS)}
              style={{ width: focusedWidth, height: focusedHeight }}
            >
              {focusedCard}
            </div>
          </div>
          {stripCards.length > 0 && (
            <div className="relative shrink-0">
              <div
                inert={participantsHidden}
                aria-hidden={participantsHidden}
                className={cn(
                  'flex h-[104px] shrink-0 justify-center-safe gap-2 overflow-x-auto',
                  'transition-[max-height,opacity] duration-300 ease-in-out',
                  participantsHidden
                    ? 'max-h-0 opacity-0'
                    : 'max-h-[104px] opacity-100'
                )}
              >
                {stripCards.map((card, index) => (
                  // the participant thumbnails keep the size of the Discord
                  // overlay container, so a pinned view does not change the
                  // frame of a user
                  <div key={index} className="h-[104px] w-[187px] shrink-0">
                    {card}
                  </div>
                ))}
              </div>
              {onToggleParticipants && (
                <ParticipantsPill
                  hidden={participantsHidden}
                  onToggle={onToggleParticipants}
                />
              )}
            </div>
          )}
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
              ((containerSize.height - 72 - (rows - 1) * 12) / rows) *
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
          'grid size-full gap-3 bg-rail px-7 pt-14 pb-6',
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
