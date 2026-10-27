import { SoundType } from '@/features/server/types';
import { describe, expect, test } from 'bun:test';
import { shouldPlaySound } from '../sounds';

const allOn = {
  notificationSounds: true,
  messageSentSound: true,
  joinLeaveSounds: true,
  muteDeafenSounds: true
};

describe('shouldPlaySound', () => {
  test('mutes everything when notification sounds are off', () => {
    const preferences = { ...allOn, notificationSounds: false };

    expect(shouldPlaySound(SoundType.MESSAGE_RECEIVED, preferences)).toBe(
      false
    );
    expect(
      shouldPlaySound(SoundType.OWN_USER_JOINED_VOICE_CHANNEL, preferences)
    ).toBe(false);
    expect(shouldPlaySound(SoundType.OWN_USER_MUTED_MIC, preferences)).toBe(
      false
    );
  });

  test('mutes join and leave sounds when that group is off', () => {
    const preferences = { ...allOn, joinLeaveSounds: false };

    expect(
      shouldPlaySound(SoundType.OWN_USER_JOINED_VOICE_CHANNEL, preferences)
    ).toBe(false);
    expect(
      shouldPlaySound(SoundType.OWN_USER_LEFT_VOICE_CHANNEL, preferences)
    ).toBe(false);
    expect(
      shouldPlaySound(SoundType.REMOTE_USER_JOINED_VOICE_CHANNEL, preferences)
    ).toBe(false);
    expect(
      shouldPlaySound(SoundType.REMOTE_USER_LEFT_VOICE_CHANNEL, preferences)
    ).toBe(false);

    // other groups stay audible
    expect(shouldPlaySound(SoundType.MESSAGE_RECEIVED, preferences)).toBe(true);
    expect(shouldPlaySound(SoundType.OWN_USER_MUTED_MIC, preferences)).toBe(
      true
    );
  });

  test('mutes mute and deafen sounds when that group is off', () => {
    const preferences = { ...allOn, muteDeafenSounds: false };

    expect(shouldPlaySound(SoundType.OWN_USER_MUTED_MIC, preferences)).toBe(
      false
    );
    expect(shouldPlaySound(SoundType.OWN_USER_UNMUTED_MIC, preferences)).toBe(
      false
    );
    expect(shouldPlaySound(SoundType.OWN_USER_MUTED_SOUND, preferences)).toBe(
      false
    );
    expect(shouldPlaySound(SoundType.OWN_USER_UNMUTED_SOUND, preferences)).toBe(
      false
    );

    // other groups stay audible
    expect(shouldPlaySound(SoundType.MESSAGE_RECEIVED, preferences)).toBe(true);
    expect(
      shouldPlaySound(SoundType.OWN_USER_JOINED_VOICE_CHANNEL, preferences)
    ).toBe(true);
  });
});
