import { useStore } from '@/features/store-context';
import { useCallback, useMemo } from 'react';
import { prefetchMessages } from './database';
import { canPrefetchMessages } from './navigation-intent';

// Only the pointed-to/focused text or DM row is considered; no list-wide warming or
// voice join side effects. Opening the row shares Query's in-flight page request.
export const useMessageNavigationIntent = (channelId: number) => {
  const currentStore = useStore();
  const prefetch = useCallback(() => {
    if (!canPrefetchMessages(currentStore.getState(), channelId)) return;
    prefetchMessages(currentStore, channelId);
  }, [currentStore, channelId]);
  return useMemo(
    () => ({ onPointerEnter: prefetch, onFocus: prefetch }),
    [prefetch]
  );
};
