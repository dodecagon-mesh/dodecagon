import { ServerEvents, StreamKind } from '@dodecagon/shared';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { WebRtcTransport } from 'mediasoup/types';
import { createFakeSocket, initTest } from '../../__tests__/helpers';
import { config } from '../../config';
import * as users from '../../db/queries/users';
import { pluginManager } from '../../plugins';
import { VoiceRuntime } from '../../runtimes/voice';
import { pubsub } from '../../utils/pubsub';
import type { Context } from '../../utils/trpc';
import { getOnlineUserIds, handleSocketClose } from '../../utils/wss';

const state = { micMuted: false, soundMuted: false };
const runtimes: VoiceRuntime[] = [];
const room = async () => {
  const runtime = new VoiceRuntime(2);
  runtimes.push(runtime);
  await runtime.init();
  return runtime;
};
const connection = async (overrides?: Partial<Context>) => {
  const socket = createFakeSocket();
  return { socket, ...(await initTest(2, { socket }, overrides)) };
};
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.destroy();
});

describe('voice connection ownership', () => {
  test('reclaims a ghost, closes its transports, and rejects the old connection authority', async () => {
    const runtime = await room();
    const old = await connection();
    const replacement = await connection();
    await old.caller.voice.join({ channelId: 2, state });
    await old.caller.voice.createProducerTransport();
    await old.caller.voice.createConsumerTransport();
    const producerTransport = runtime.getProducerTransport(2)!;
    const consumerTransport = runtime.getConsumerTransport(2)!;
    const result = await replacement.caller.voice.join({ channelId: 2, state });
    expect(result.routerRtpCapabilities).toBeDefined();
    expect(runtime.getState().users.map((user) => user.userId)).toEqual([2]);
    expect(producerTransport.closed).toBe(true);
    expect(consumerTransport.closed).toBe(true);
    await replacement.caller.voice.createProducerTransport();
    const currentTransport = runtime.getProducerTransport(2);
    await expect(
      old.caller.voice.updateState({ micMuted: true })
    ).rejects.toThrow();
    await expect(
      old.caller.voice.closeProducer({ kind: StreamKind.AUDIO })
    ).rejects.toThrow();
    await expect(old.caller.voice.leave()).rejects.toThrow();
    await expect(
      old.caller.voice.join({ channelId: 2, state })
    ).rejects.toThrow();
    await handleSocketClose(old.socket);
    expect(runtime.getProducerTransport(2)).toBe(currentTransport);
    expect(runtime.getUserState(2).micMuted).toBe(false);
    expect(runtime.getState().users).toHaveLength(1);
    await replacement.caller.voice.leave();
    expect(runtime.getUser(2)).toBeUndefined();
  });

  test('owner close removes voice while a text session keeps account presence', async () => {
    const runtime = await room();
    const owner = await connection();
    const text = await connection();
    await owner.caller.voice.join({ channelId: 2, state });
    const departures: unknown[] = [];
    const subscription = (await text.caller.voice.onLeave()).subscribe({
      next: (event) => departures.push(event)
    });
    await handleSocketClose(owner.socket);
    expect(runtime.getUser(2)).toBeUndefined();
    expect(getOnlineUserIds()).toContain(2);
    expect(departures).toHaveLength(1);
    await text.caller.voice.join({ channelId: 2, state });
    await handleSocketClose(text.socket);
    expect(runtime.getUser(2)).toBeUndefined();
    expect(getOnlineUserIds()).not.toContain(2);
    subscription.unsubscribe();
  });

  test('a rejected takeover preserves the original call and its resources', async () => {
    const runtime = await room();
    const owner = await connection();
    const other = await connection();
    await owner.caller.voice.join({ channelId: 2, state });
    await owner.caller.voice.createProducerTransport();
    const transport = runtime.getProducerTransport(2);
    await expect(
      other.caller.voice.join({ channelId: 4, state })
    ).rejects.toThrow('Insufficient channel permissions');
    expect(runtime.getProducerTransport(2)).toBe(transport);
    await owner.caller.voice.updateState({ micMuted: true });
    expect(runtime.getUserState(2).micMuted).toBe(true);
  });

  test('an async authorization or hook cannot overwrite a newer join', async () => {
    const runtime = await room();
    const slow = await connection();
    const fast = await connection();
    const { promise: waiting, resolve: entered } =
      Promise.withResolvers<void>();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const hooks = spyOn(pluginManager, 'getHooks').mockImplementation((name) =>
      name === 'beforeVoiceJoin'
        ? ([
            {
              pluginId: 'ownership-test',
              handlers: [
                async () => {
                  entered();
                  await gate;
                }
              ]
            }
          ] as never)
        : []
    );
    const pending = slow.caller.voice.join({ channelId: 2, state });
    await waiting;
    hooks.mockRestore();
    await fast.caller.voice.join({ channelId: 2, state });
    await fast.caller.voice.createProducerTransport();
    const transport = runtime.getProducerTransport(2);
    release();
    await expect(pending).rejects.toThrow();
    expect(runtime.getProducerTransport(2)).toBe(transport);
    expect(runtime.getState().users).toHaveLength(1);
  });

  test('replacement join survives its predecessor closing during the join hook', async () => {
    const runtime = await room();
    const owner = await connection();
    const replacement = await connection();
    await owner.caller.voice.join({ channelId: 2, state });
    await owner.caller.voice.createProducerTransport();
    const oldTransport = runtime.getProducerTransport(2)!;
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const hooks = spyOn(pluginManager, 'getHooks').mockImplementation((name) =>
      name === 'beforeVoiceJoin'
        ? ([
            {
              pluginId: 'ownership-test',
              handlers: [
                async () => {
                  entered.resolve();
                  await gate.promise;
                }
              ]
            }
          ] as never)
        : []
    );
    try {
      const pending = replacement.caller.voice.join({ channelId: 2, state });
      await entered.promise;
      await handleSocketClose(owner.socket);
      expect(oldTransport.closed).toBe(true);
      expect(runtime.getUser(2)).toBeUndefined();
      gate.resolve();
      expect((await pending).routerRtpCapabilities).toBeDefined();
      await replacement.caller.voice.createProducerTransport();
      const transport = runtime.getProducerTransport(2);
      await handleSocketClose(owner.socket);
      expect(runtime.getProducerTransport(2)).toBe(transport);
      expect(transport?.closed).toBe(false);
      expect(runtime.getState().users).toHaveLength(1);
      await expect(owner.caller.voice.leave()).rejects.toThrow();
    } finally {
      gate.resolve();
      hooks.mockRestore();
    }
  });

  test('a transport created after takeover is closed rather than attached to the replacement', async () => {
    const runtime = await room();
    const old = await connection();
    const replacement = await connection();
    await old.caller.voice.join({ channelId: 2, state });
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const createTransport = runtime.createTransport;
    let lateTransport: WebRtcTransport | undefined;
    const create = spyOn(runtime, 'createTransport').mockImplementationOnce(
      async (userId) => {
        const result = await createTransport(userId);
        lateTransport = result.transport;
        entered.resolve();
        await gate.promise;
        return result;
      }
    );
    try {
      const pending = old.caller.voice.createProducerTransport();
      const rejected = pending.catch((error: unknown) => error);
      await entered.promise;
      await replacement.caller.voice.join({ channelId: 2, state });
      await replacement.caller.voice.createProducerTransport();
      const transport = runtime.getProducerTransport(2);
      gate.resolve();
      expect(await rejected).toBeInstanceOf(Error);
      expect(lateTransport?.closed).toBe(true);
      expect(runtime.getProducerTransport(2)).toBe(transport);
    } finally {
      gate.resolve();
      create.mockRestore();
    }
  });

  test('takeover invalidates direct media registrations and sessions', async () => {
    const enabled = config.webRtc.holepunchMediaEnabled;
    config.webRtc.holepunchMediaEnabled = true;
    try {
      const runtime = await room();
      const old = await connection();
      const replacement = await connection();
      const peer = await initTest(1, { socket: createFakeSocket() });
      await old.caller.voice.join({ channelId: 2, state });
      await peer.caller.voice.join({ channelId: 2, state });
      const oldRegistration = runtime.registerDirectMediaSubscriber(2, true);
      runtime.registerDirectMediaSubscriber(1, true);
      const direct = runtime.startDirectMedia(2, StreamKind.AUDIO, 1)!;
      expect(direct).not.toBeNull();
      await replacement.caller.voice.join({ channelId: 2, state });
      expect(oldRegistration.isCurrent()).toBe(false);
      expect(
        runtime.getDirectMediaSession(direct.sessionId, 1)
      ).toBeUndefined();
      expect(runtime.hasDirectMediaCapability(2, StreamKind.AUDIO)).toBe(false);
    } finally {
      config.webRtc.holepunchMediaEnabled = enabled;
    }
  });

  test('plugin rejection and update lock both preserve the original call', async () => {
    const runtime = await room();
    const owner = await connection();
    const other = await connection();
    await owner.caller.voice.join({ channelId: 2, state });
    await owner.caller.voice.createProducerTransport();
    const transport = runtime.getProducerTransport(2);
    const hooks = spyOn(pluginManager, 'getHooks').mockImplementation((name) =>
      name === 'beforeVoiceJoin'
        ? ([
            {
              pluginId: 'ownership-test',
              handlers: [
                async () => ({ reject: 'This call must remain active' })
              ]
            }
          ] as never)
        : []
    );
    try {
      await expect(
        other.caller.voice.join({ channelId: 2, state })
      ).rejects.toThrow('This call must remain active');
      expect(runtime.getProducerTransport(2)).toBe(transport);
    } finally {
      hooks.mockRestore();
    }
    expect(VoiceRuntime.beginIdleUpdate(true)).toBe(true);
    try {
      await expect(
        other.caller.voice.join({ channelId: 2, state })
      ).rejects.toThrow('The server is installing an update');
      expect(runtime.getProducerTransport(2)).toBe(transport);
      expect(transport?.closed).toBe(false);
    } finally {
      VoiceRuntime.endIdleUpdate();
    }
    await owner.caller.voice.updateState({ micMuted: true });
    expect(runtime.getUserState(2).micMuted).toBe(true);
  });

  test('closing during an async join cannot resurrect the departed connection', async () => {
    const runtime = await room();
    const old = await connection();
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const hooks = spyOn(pluginManager, 'getHooks').mockImplementation((name) =>
      name === 'beforeVoiceJoin'
        ? ([
            {
              pluginId: 'ownership-test',
              handlers: [
                async () => {
                  entered.resolve();
                  await gate.promise;
                }
              ]
            }
          ] as never)
        : []
    );
    try {
      const pending = old.caller.voice.join({ channelId: 2, state });
      const rejected = pending.catch((error: unknown) => error);
      await entered.promise;
      await handleSocketClose(old.socket);
      gate.resolve();
      expect(await rejected).toBeInstanceOf(Error);
      expect(runtime.getUser(2)).toBeUndefined();
    } finally {
      gate.resolve();
      hooks.mockRestore();
    }
  });

  test('a queued state RPC cannot mutate the replacement after its permission check', async () => {
    const runtime = await room();
    let block = false;
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const old = await connection({
      hasChannelPermission: async () => {
        if (block) {
          entered.resolve();
          await gate.promise;
        }
        return true;
      }
    });
    const replacement = await connection();
    await old.caller.voice.join({ channelId: 2, state });
    block = true;
    const pending = old.caller.voice.updateState({ micMuted: true });
    const rejected = pending.catch((error: unknown) => error);
    await entered.promise;
    await replacement.caller.voice.join({ channelId: 2, state });
    gate.resolve();
    expect(await rejected).toBeInstanceOf(Error);
    expect(runtime.getUserState(2).micMuted).toBe(false);
  });

  test('last-socket cleanup does not announce offline after a new session authenticates', async () => {
    const old = await connection();
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const getUser = users.getUserById;
    const lookup = spyOn(users, 'getUserById').mockImplementationOnce(
      async (userId) => {
        entered.resolve();
        await gate.promise;
        return getUser(userId);
      }
    );
    const departures: number[] = [];
    const subscription = pubsub
      .subscribe(ServerEvents.USER_LEAVE)
      .subscribe({ next: (userId) => departures.push(userId) });
    try {
      const pending = handleSocketClose(old.socket);
      await entered.promise;
      await connection();
      gate.resolve();
      await pending;
      expect(getOnlineUserIds()).toContain(2);
      expect(departures).toEqual([]);
    } finally {
      gate.resolve();
      lookup.mockRestore();
      subscription.unsubscribe();
    }
  });
});
