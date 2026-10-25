import {
  shouldUseFallbackImage,
  type TEmojiItem
} from '@/components/tiptap-input/helpers';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { GRID_COLS } from './emoji-data';

const COLUMN_INDICES = Array.from({ length: GRID_COLS }, (_, index) => index);
const ROW_HEIGHT = 32;
const ROW_GAP = 4;

type TEmojiButtonProps = {
  emoji: TEmojiItem;
  onSelect: (emoji: TEmojiItem) => void;
};

const EmojiButton = memo(({ emoji, onSelect }: TEmojiButtonProps) => {
  const useImage = shouldUseFallbackImage(emoji);
  const handleClick = useCallback(() => onSelect(emoji), [onSelect, emoji]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-8 h-8 flex items-center justify-center hover:bg-accent rounded-md transition-colors cursor-pointer"
      title={`:${emoji.shortcodes[0]}:`}
    >
      {emoji.emoji && !useImage ? (
        <span className="text-xl leading-none">{emoji.emoji}</span>
      ) : emoji.fallbackImage ? (
        <img
          src={emoji.fallbackImage}
          alt={emoji.name}
          className="w-6 h-6 object-contain"
          loading="lazy"
        />
      ) : (
        <span className="text-xs text-muted-foreground truncate">
          {emoji.shortcodes[0]}
        </span>
      )}
    </button>
  );
});

type TEmojiGridProps = {
  emojis: TEmojiItem[];
  onSelect: (emoji: TEmojiItem) => void;
};

const EmojiGrid = memo(({ emojis, onSelect }: TEmojiGridProps) => {
  const scroller = useRef<HTMLDivElement>(null);
  const rowCount = useMemo(
    () => Math.ceil(emojis.length / GRID_COLS),
    [emojis.length]
  );

  const getScrollElement = useCallback(() => scroller.current, []);
  const estimateSize = useCallback(() => ROW_HEIGHT, []);
  const getItemKey = useCallback(
    (index: number) => emojis[index * GRID_COLS]?.name ?? index,
    [emojis]
  );
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    estimateSize,
    getItemKey,
    enabled: rowCount > 6,
    gap: ROW_GAP,
    paddingStart: 12,
    paddingEnd: 12,
    overscan: 6
  });

  useLayoutEffect(() => {
    if (rowCount > 6) virtualizer.scrollToOffset(0);
  }, [emojis, rowCount, virtualizer]);

  if (emojis.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No emojis found
      </div>
    );
  }

  if (rowCount <= 6) {
    return (
      <div className="grid grid-cols-8 gap-1 p-3">
        {emojis.map((emoji) => (
          <EmojiButton key={emoji.name} emoji={emoji} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <div ref={scroller} className="h-full min-h-0 overflow-y-auto">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="absolute top-0 left-0 grid w-full grid-cols-8 gap-1 px-3"
            style={{
              height: ROW_HEIGHT,
              transform: `translateY(${row.start}px)`
            }}
          >
            {COLUMN_INDICES.map((column) => {
              const emoji = emojis[row.index * GRID_COLS + column];
              if (!emoji) return null;
              return (
                <EmojiButton
                  key={emoji.name}
                  emoji={emoji}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});

export { EmojiButton, EmojiGrid };
