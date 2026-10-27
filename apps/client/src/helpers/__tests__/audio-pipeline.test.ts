import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  canUseAudioContext,
  resumeMediaPlayback,
  subscribeToAudioPipelineLoss,
  trackAudioContext
} from '../audio-pipeline';

// chromium reports a lost device as an `error` event plus a suspended context
const createFakeContext = (state: AudioContextState = 'running') => {
  const handlers = new Map<string, Set<EventListener>>();
  const context = {
    state,
    emit: (type: string) => {
      for (const handler of handlers.get(type) ?? []) {
        handler(new Event(type));
      }
    },
    addEventListener: (type: string, listener: EventListener) => {
      const set = handlers.get(type) ?? new Set<EventListener>();

      set.add(listener);
      handlers.set(type, set);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      handlers.get(type)?.delete(listener);
    }
  };
  const audioContext = context as unknown as AudioContext;

  return {
    context,
    audioContext,
    track: () => trackAudioContext(audioContext)
  };
};

const createFakeElement = (stream: MediaStream | null) => {
  const assignments: (MediaStream | null)[] = [];
  const plays: number[] = [];
  let srcObject = stream;

  const element = {
    get srcObject() {
      return srcObject;
    },
    set srcObject(next: MediaStream | null) {
      srcObject = next;
      assignments.push(next);
    },
    play: async () => {
      plays.push(1);
    }
  };

  return {
    element: element as unknown as HTMLAudioElement,
    assignments,
    plays
  };
};

describe('audio pipeline loss', () => {
  const losses: number[] = [];
  let unsubscribe: () => void = () => {};

  beforeAll(() => {
    unsubscribe = subscribeToAudioPipelineLoss(() => {
      losses.push(Date.now());
    });
  });

  afterAll(() => {
    unsubscribe();
  });

  test('a suspension after the context ran is a lost device', () => {
    const before = losses.length;
    const { context, audioContext, track } = createFakeContext('running');

    track();
    expect(canUseAudioContext(audioContext)).toBe(true);

    context.state = 'suspended';
    context.emit('statechange');

    expect(losses).toHaveLength(before + 1);
    expect(canUseAudioContext(audioContext)).toBe(false);
  });

  test('an autoplay suspension is not a lost device', () => {
    const before = losses.length;
    const { context, audioContext, track } = createFakeContext('suspended');

    track();
    context.emit('statechange');

    expect(losses).toHaveLength(before);
    expect(canUseAudioContext(audioContext)).toBe(true);
  });

  test('one outage reaches the listeners once', () => {
    const before = losses.length;
    const { context, track } = createFakeContext('running');

    track();
    context.emit('error');
    context.emit('error');

    expect(losses).toHaveLength(before + 1);
    expect(losses).toHaveLength(2);
  });

  test('a context that starts running makes the next outage reportable', () => {
    const before = losses.length;
    const { context, track } = createFakeContext('running');

    track();
    context.emit('error');

    expect(losses).toHaveLength(before + 1);
    expect(losses).toHaveLength(3);
  });

  test('resuming replaces the dead output stream and replays the element', async () => {
    const stream = { id: 'remote-audio' } as unknown as MediaStream;
    const { element, assignments, plays } = createFakeElement(stream);

    await resumeMediaPlayback(element);

    expect(assignments).toEqual([null, stream]);
    expect(plays).toHaveLength(1);
  });

  test('an element without a source is left alone', async () => {
    const { element, assignments, plays } = createFakeElement(null);

    await resumeMediaPlayback(element);

    expect(assignments).toHaveLength(0);
    expect(plays).toHaveLength(0);
  });
});
