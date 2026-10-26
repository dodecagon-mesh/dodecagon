import { useStoreSelector } from '@/features/store';
import { isServerScreenOpenSelector, overlaySelector } from './selectors';

export const useOverlay = () => useStoreSelector(overlaySelector);

export const useIsServerScreenOpen = () =>
  useStoreSelector(isServerScreenOpenSelector);
