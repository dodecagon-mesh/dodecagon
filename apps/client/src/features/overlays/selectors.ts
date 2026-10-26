import type { IRootState } from '../store';

export const overlaySelector = (state: IRootState) => state.overlay;

export const isServerScreenOpenSelector = (state: IRootState) =>
  state.overlay?.kind === 'serverScreen';
