import { Resolution, VideoCodec } from '@/types';
import { describe, expect, test } from 'bun:test';
import {
  getScreenShareCodecCandidates,
  getScreenShareContentHint,
  getScreenSharePreset,
  ScreenSharePreset
} from '../screen-share-presets';

describe('screen share presets', () => {
  test('detects the motion preset and its content hint', () => {
    const settings = {
      screenResolution: Resolution['1080p'],
      screenFramerate: 60,
      screenBitrate: 8000
    };

    expect(getScreenSharePreset(settings)).toBe(ScreenSharePreset.MOTION);
    expect(getScreenShareContentHint(settings)).toBe('motion');
  });

  test('keeps manual settings on the legacy motion hint', () => {
    const settings = {
      screenResolution: Resolution['720p'],
      screenFramerate: 30,
      screenBitrate: 4000
    };

    expect(getScreenSharePreset(settings)).toBeUndefined();
    expect(getScreenShareContentHint(settings)).toBe('motion');
  });

  test('motion prefers H264 then falls back to VP8', () => {
    expect(
      getScreenShareCodecCandidates(ScreenSharePreset.MOTION, VideoCodec.H264)
    ).toEqual([VideoCodec.H264, VideoCodec.VP8]);
  });

  test('text prefers H264, then VP9, then VP8', () => {
    expect(
      getScreenShareCodecCandidates(ScreenSharePreset.TEXT, VideoCodec.VP9)
    ).toEqual([VideoCodec.H264, VideoCodec.VP9, VideoCodec.VP8]);
  });
});
