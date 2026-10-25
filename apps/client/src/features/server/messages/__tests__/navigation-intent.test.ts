import { serverInitialState } from '@/features/server/slice';
import type { IRootState } from '@/features/store';
import {
  ChannelPermission,
  ChannelType,
  OWNER_ROLE_ID,
  type TChannel
} from '@dodecagon/shared';
import { describe, expect, test } from 'bun:test';
import { canPrefetchMessages } from '../navigation-intent';

const state = (
  channel: Partial<TChannel>,
  view = false,
  owner = false
): IRootState =>
  ({
    server: {
      ...serverInitialState,
      connected: true,
      ownUserId: 1,
      channels: [
        { id: 2, type: ChannelType.TEXT, private: true, ...channel } as TChannel
      ],
      channelPermissions: {
        2: { permissions: { [ChannelPermission.VIEW_CHANNEL]: view } }
      },
      users: [{ id: 1, roleIds: owner ? [OWNER_ROLE_ID] : [] }],
      roles: owner ? [{ id: OWNER_ROLE_ID, permissions: [] }] : []
    }
  }) as unknown as IRootState;

describe('message navigation intent permissions', () => {
  test('allows permitted private text and public text channels but not hidden private channels', () => {
    expect(canPrefetchMessages(state({}, true), 2)).toBe(true);
    expect(canPrefetchMessages(state({ private: false }), 2)).toBe(true);
    expect(canPrefetchMessages(state({}), 2)).toBe(false);
    expect(canPrefetchMessages(state({}, false, true), 2)).toBe(true);
  });

  test('never warms a voice row or an unknown channel', () => {
    expect(
      canPrefetchMessages(state({ type: ChannelType.VOICE }, true), 2)
    ).toBe(false);
    expect(canPrefetchMessages(state({}, true), 99)).toBe(false);
  });

  test('requires actual DM membership even for an owner', () => {
    expect(canPrefetchMessages(state({ isDm: true }, true), 2)).toBe(true);
    expect(canPrefetchMessages(state({ isDm: true }, false, true), 2)).toBe(
      false
    );
  });

  test('does not prefetch while disconnected or after an account reset', () => {
    const disconnected = state({}, true);
    disconnected.server.connected = false;
    expect(canPrefetchMessages(disconnected, 2)).toBe(false);
    const reset = state({}, true);
    reset.server.ownUserId = undefined;
    expect(canPrefetchMessages(reset, 2)).toBe(false);
  });
});
