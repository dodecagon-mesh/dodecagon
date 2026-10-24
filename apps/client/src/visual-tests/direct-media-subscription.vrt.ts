import { useDirectMedia } from '@/components/voice-provider/hooks/use-direct-media';
import * as trpc from '@/lib/trpc';
import { StreamKind } from '@dodecagon/shared';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('@/lib/trpc', { spy: true });

beforeEach(() => {
  vi.stubGlobal('dodecagonDesktop', {
    media: {
      version: 1,
      create: async () => ({ publicKey: 'a'.repeat(64), port: 45000 }),
      connect: async () => {},
      close: async () => {},
      onClosed: () => () => {}
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

test('voice-only microphone publication waits for the direct subscription acknowledgement', async () => {
  let started: (() => void) | undefined;
  const prepare = vi.fn(async () => null);
  const unsubscribe = vi.fn();
  const subscribe = vi.fn(
    (_input: unknown, callbacks: { onStarted?: () => void }) => {
      started = callbacks.onStarted;
      return { unsubscribe };
    }
  );
  vi.mocked(trpc.getTRPCClient).mockReturnValue({
    voice: {
      onDirectMediaSignal: { subscribe },
      startDirectMedia: { mutate: prepare },
      signalDirectMedia: { mutate: vi.fn(async () => {}) }
    }
  } as unknown as ReturnType<typeof trpc.getTRPCClient>);
  let subject: ReturnType<typeof useDirectMedia> | undefined;
  const Fixture = () => {
    subject = useDirectMedia({
      channelId: 2,
      enabled: true,
      voiceOnlyMode: true,
      isVoiceSessionActive: true,
      canConsumeScreen: () => false,
      onRemoteDemoStoppedRef: { current: vi.fn() },
      addRemoteUserStream: vi.fn(),
      removeRemoteUserStream: vi.fn()
    });
    return null;
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let context: AudioContext | undefined;
  try {
    root.render(createElement(Fixture));
    await expect.poll(() => subscribe.mock.calls.length).toBe(1);
    expect(subject?.directMedia).toBeDefined();
    expect(subject?.directMedia[StreamKind.AUDIO]).toBeDefined();
    context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    let result: string | undefined;
    const pending = subject!.directMedia[StreamKind.AUDIO]
      .startForPeer(3, destination.stream, {
        maxBitrate: 128000,
        onFailure: vi.fn(async () => {})
      })
      .then((value) => {
        result = value;
      });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
    started!();
    await pending;
    expect(result).toBe('relay');
    destination.stream.getTracks().forEach((track) => track.stop());
  } finally {
    root.unmount();
    host.remove();
    await context?.close();
    vi.restoreAllMocks();
  }
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('a superseded subscription error cannot clear the replacement acknowledgement', async () => {
  const callbacks: {
    onStarted: () => void;
    onError: (error: Error) => void;
  }[] = [];
  const prepare = vi.fn(async () => null);
  const subscribe = vi.fn(
    (_input: unknown, value: (typeof callbacks)[number]) => {
      callbacks.push(value);
      return { unsubscribe: vi.fn() };
    }
  );
  vi.mocked(trpc.getTRPCClient).mockReturnValue({
    voice: {
      onDirectMediaSignal: { subscribe },
      startDirectMedia: { mutate: prepare },
      signalDirectMedia: { mutate: vi.fn(async () => {}) }
    }
  } as unknown as ReturnType<typeof trpc.getTRPCClient>);
  const parameters = {
    enabled: true,
    voiceOnlyMode: true,
    isVoiceSessionActive: true,
    canConsumeScreen: () => false,
    onRemoteDemoStoppedRef: { current: vi.fn() },
    addRemoteUserStream: vi.fn(),
    removeRemoteUserStream: vi.fn()
  };
  let subject: ReturnType<typeof useDirectMedia> | undefined;
  const Fixture = ({ channelId }: { channelId: number }) => {
    subject = useDirectMedia({ ...parameters, channelId });
    return null;
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  try {
    root.render(createElement(Fixture, { channelId: 2 }));
    await expect.poll(() => callbacks.length).toBe(1);
    callbacks[0]!.onStarted();
    root.render(createElement(Fixture, { channelId: 4 }));
    await expect.poll(() => callbacks.length).toBe(2);
    callbacks[1]!.onStarted();
    callbacks[0]!.onError(new Error('obsolete subscription'));
    const pending = subject!.directMedia.audio.startForPeer(
      3,
      destination.stream,
      {
        maxBitrate: 128000,
        onFailure: vi.fn(async () => {})
      }
    );
    await expect.poll(() => prepare.mock.calls.length).toBe(1);
    expect(await pending).toBe('relay');
  } finally {
    root.unmount();
    host.remove();
    destination.stream.getTracks().forEach((track) => track.stop());
    await context.close();
    vi.restoreAllMocks();
  }
});
