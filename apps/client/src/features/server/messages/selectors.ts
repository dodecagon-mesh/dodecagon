import type { IRootState } from '@/features/store';

export const typingMapSelector = (state: IRootState) => state.server.typingMap;

export const threadTypingMapSelector = (state: IRootState) =>
  state.server.threadTypingMap;
