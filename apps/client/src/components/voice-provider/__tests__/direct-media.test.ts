import {
  getP2PDiagnosticsSnapshot,
  resetP2PDiagnostics
} from '@/helpers/p2p-diagnostics';
import {
  StreamKind,
  type TDirectMediaEvent,
  type TDirectMediaKind,
  type TDirectMediaSession,
  type TDirectMediaSignal
} from '@dodecagon/shared';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  DirectMedia,
  type TDirectMediaResult,
  type TDirectScreenBundle,
  type TDirectScreenRetirement
} from '../direct-media';
import type { THolepunchMedia } from '../holepunch-media';

// bun has no native RTC implementation; this double models native state and
// deferred operations, while browser verification covers SDP and actual media.
const OFFER = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
const ANSWER = 'v=0\r\no=- 2 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
const CANDIDATE = 'a=candidate:1 1 UDP 2122260223 192.0.2.1 5000 typ host\r\n';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const flush = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve();
};

class TestClock {
  now = 0;
  nextId = 1;
  timers = new Map<number, { at: number; callback: () => void }>();

  setTimeout = (callback: () => void, delay = 0) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + delay, callback });
    return id;
  };

  clearTimeout = (id: number) => {
    this.timers.delete(id);
  };

  advance = async (duration: number) => {
    const end = this.now + duration;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      this.now = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    this.now = end;
    await flush();
  };
}

class TestTrack extends EventTarget {
  kind: string;
  stopped = 0;
  readyState = 'live';

  constructor(kind: string) {
    super();
    this.kind = kind;
  }

  stop = () => {
    this.stopped++;
    this.readyState = 'ended';
  };
}

class TestStream {
  tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks = () => [...this.tracks];
  getVideoTracks = () => this.tracks.filter((track) => track.kind === 'video');
  getAudioTracks = () => this.tracks.filter((track) => track.kind === 'audio');
}

const deliveredStats = (kind: string): RTCStatsReport =>
  new Map([
    [
      `inbound-${kind}`,
      {
        id: `inbound-${kind}`,
        timestamp: 1,
        type: 'inbound-rtp',
        kind,
        mediaType: kind,
        packetsReceived: 1,
        framesDecoded: kind === 'video' ? 1 : undefined,
        totalSamplesReceived: kind === 'audio' ? 1 : undefined,
        jitterBufferEmittedCount: kind === 'audio' ? 1 : undefined
      }
    ]
  ]) as unknown as RTCStatsReport;

class TestReceiver {
  constructor(
    readonly track: MediaStreamTrack,
    private readonly stats: Promise<RTCStatsReport>
  ) {}

  getStats = () => this.stats;
}

type TPeerPlan = {
  offer?: Promise<void>;
  answer?: Promise<void>;
  remote?: Promise<void>;
  local?: Promise<void>;
  gathering?: boolean;
};

class TestPeer extends EventTarget {
  static instances: TestPeer[] = [];
  static plans: TPeerPlan[] = [];
  configuration: RTCConfiguration;
  plan: TPeerPlan;
  connectionState: RTCPeerConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'new';
  signalingState: RTCSignalingState = 'stable';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  transceivers: {
    track: MediaStreamTrack;
    init: RTCRtpTransceiverInit;
    codecs: RTCRtpCodec[];
  }[] = [];
  closeCount = 0;
  receivers: TestReceiver[] = [];

  constructor(configuration: RTCConfiguration) {
    super();
    if (
      configuration.iceServers?.some(
        ({ urls }) => Array.isArray(urls) && !urls.length
      )
    ) {
      throw new DOMException(
        'ICE server parsing failed: Empty uri.',
        'SyntaxError'
      );
    }
    this.configuration = configuration;
    this.plan = TestPeer.plans.shift() ?? {};
    TestPeer.instances.push(this);
  }

  assertOpen = () => {
    if (this.connectionState === 'closed') throw new Error('peer is closed');
  };

  addTransceiver = (track: MediaStreamTrack, init: RTCRtpTransceiverInit) => {
    this.assertOpen();
    const entry = { track, init, codecs: [] as RTCRtpCodec[] };
    this.transceivers.push(entry);
    return {
      setCodecPreferences: (codecs: RTCRtpCodec[]) => {
        entry.codecs = codecs;
      }
    };
  };

  createOffer = async () => {
    this.assertOpen();
    if (!this.transceivers.length) throw new Error('no send transceivers');
    await this.plan.offer;
    return { type: 'offer', sdp: OFFER } as RTCSessionDescriptionInit;
  };

  createAnswer = async () => {
    this.assertOpen();
    if (this.remoteDescription?.type !== 'offer') {
      throw new Error('answer requires remote offer');
    }
    await this.plan.answer;
    return { type: 'answer', sdp: ANSWER } as RTCSessionDescriptionInit;
  };

  setLocalDescription = async (description: RTCSessionDescriptionInit) => {
    this.assertOpen();
    await this.plan.local;
    this.localDescription = description;
    this.signalingState =
      description.type === 'offer' ? 'have-local-offer' : 'stable';
    this.iceGatheringState = this.plan.gathering ? 'gathering' : 'complete';
    if (!this.plan.gathering) {
      this.localDescription = {
        ...description,
        sdp: description.sdp + CANDIDATE
      };
    }
  };

  setRemoteDescription = async (description: RTCSessionDescriptionInit) => {
    this.assertOpen();
    if (
      description.type === 'answer' &&
      this.signalingState !== 'have-local-offer'
    ) {
      throw new Error('answer requires local offer');
    }
    await this.plan.remote;
    this.remoteDescription = description;
    this.signalingState =
      description.type === 'offer' ? 'have-remote-offer' : 'stable';
  };

  gather = () => {
    this.iceGatheringState = 'complete';
    if (this.localDescription) {
      this.localDescription = {
        ...this.localDescription,
        sdp: this.localDescription.sdp + CANDIDATE
      };
    }
    this.dispatchEvent(new Event('icegatheringstatechange'));
  };

  connect = (state: RTCPeerConnectionState = 'connected') => {
    this.connectionState = state;
    this.dispatchEvent(new Event('connectionstatechange'));
  };

  receive = (
    track: MediaStreamTrack,
    stats = Promise.resolve(deliveredStats(track.kind))
  ) => {
    const receiver = new TestReceiver(track, stats);
    this.receivers.push(receiver);
    const event = new Event('track');
    Object.defineProperties(event, {
      track: { value: track },
      receiver: { value: receiver },
      streams: { value: [] }
    });
    this.dispatchEvent(event);
    return receiver;
  };
  getReceivers = () => [...this.receivers];

  close = () => {
    this.closeCount++;
    this.connectionState = 'closed';
    this.signalingState = 'closed';
    this.dispatchEvent(new Event('connectionstatechange'));
  };
}

const session = (sessionId = 'outgoing', peerId = 2): TDirectMediaSession => ({
  kind: StreamKind.SCREEN,
  transport: 'holepunch',
  sessionId,
  peerId
});

const event = (
  sessionId: string,
  signal: TDirectMediaSignal,
  incoming = false,
  kind: TDirectMediaKind = StreamKind.SCREEN
): TDirectMediaEvent => ({
  kind,
  transport: 'holepunch',
  relayAllowed: false,
  sessionId,
  channelId: 10,
  senderId: incoming ? 2 : 1,
  fromUserId: 2,
  signal
});

const capture = () => {
  const video = new TestTrack('video');
  const audio = new TestTrack('audio');
  const stream = new TestStream([
    video as unknown as MediaStreamTrack,
    audio as unknown as MediaStreamTrack
  ]) as unknown as MediaStream;
  return { stream, video, audio };
};

const subjects: DirectMedia[] = [];
const originals = new Map<string, PropertyDescriptor | undefined>();
let clock: TestClock;
let native: THolepunchMedia;
let nativeClosed: Set<(event: { sessionId: string }) => void>;

const replaceGlobal = (key: string, value: unknown) => {
  if (!originals.has(key))
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value
  });
};

beforeEach(() => {
  clock = new TestClock();
  resetP2PDiagnostics();
  TestPeer.instances = [];
  TestPeer.plans = [];
  nativeClosed = new Set();
  native = {
    version: 1,
    create: async () => ({ publicKey: 'a'.repeat(64), port: 45000 }),
    connect: async () => {},
    close: async () => {},
    onClosed: (callback) => {
      nativeClosed.add(callback);
      return () => nativeClosed.delete(callback);
    }
  };
  replaceGlobal('dodecagonDesktop', { media: native });
  replaceGlobal('RTCPeerConnection', TestPeer);
  replaceGlobal('MediaStream', TestStream);
  replaceGlobal('RTCRtpReceiver', {
    getCapabilities: () => ({
      codecs: [
        { mimeType: 'video/VP8', clockRate: 90000 },
        { mimeType: 'video/H264', clockRate: 90000 },
        { mimeType: 'video/rtx', clockRate: 90000 }
      ],
      headerExtensions: []
    })
  });
  replaceGlobal('setTimeout', clock.setTimeout);
  replaceGlobal('clearTimeout', clock.clearTimeout);
});

afterEach(() => {
  for (const subject of subjects.splice(0)) subject.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

type TObservedScreenStream = {
  userId: number;
  stream: MediaStream;
  kind: StreamKind;
};

type TDirectMediaFixture = {
  subject: DirectMedia;
  sent: { sessionId: string; signal: TDirectMediaSignal }[];
  statuses: string[];
  errors: unknown[];
  streams: TObservedScreenStream[];
  removed: TObservedScreenStream[];
  start: (stream?: MediaStream) => Promise<TDirectMediaResult>;
  readonly failures: number;
};

type TDirectMediaObserver = {
  presentScreenBundle?: (userId: number, bundle: TDirectScreenBundle) => void;
  retireScreenBundle?: (
    userId: number,
    bundle: TDirectScreenBundle,
    retirement: TDirectScreenRetirement
  ) => void;
};

const fixture = (
  prepare: (
    peerId: number | undefined
  ) => Promise<TDirectMediaSession | null> = async () => session(),
  send?: (sessionId: string, signal: TDirectMediaSignal) => Promise<void>,
  canReceive?: (userId: number) => boolean,
  onStopped?: (userId: number) => void,
  canDefer?: () => boolean,
  observer?: TDirectMediaObserver,
  kind: TDirectMediaKind = StreamKind.SCREEN
): TDirectMediaFixture => {
  const sent: { sessionId: string; signal: TDirectMediaSignal }[] = [];
  const statuses: string[] = [];
  const errors: unknown[] = [];
  const streams: TObservedScreenStream[] = [];
  const removed: TObservedScreenStream[] = [];
  let failures = 0;
  const subject = new DirectMedia({
    kind,
    prepare,
    canReceive,
    canDefer,
    onStopped,
    send: async (sessionId, signal) => {
      sent.push({ sessionId, signal });
      await send?.(sessionId, signal);
    },
    onStatus: (status) => statuses.push(status),
    onError: (error) => errors.push(error),
    onStream: (userId, stream, streamKind) => {
      streams.push({ userId, stream, kind: streamKind });
    },
    onRemoveStream: (userId, kind, stream) => {
      removed.push({ userId, kind, stream });
    },
    prepareScreenBundle: async () => {},
    presentScreenBundle: (userId, bundle) => {
      const received: [StreamKind, MediaStream][] = [
        [StreamKind.SCREEN, bundle.screen],
        ...(bundle.screenAudio
          ? ([[StreamKind.SCREEN_AUDIO, bundle.screenAudio]] as [
              StreamKind,
              MediaStream
            ][])
          : [])
      ];
      for (const [kind, stream] of received)
        streams.push({ userId, stream, kind });
      observer?.presentScreenBundle?.(userId, bundle);
      return true;
    },
    retireScreenBundle: (userId, bundle, retirement) => {
      const received: [StreamKind, MediaStream][] = [
        [StreamKind.SCREEN, bundle.screen],
        ...(bundle.screenAudio
          ? ([[StreamKind.SCREEN_AUDIO, bundle.screenAudio]] as [
              StreamKind,
              MediaStream
            ][])
          : [])
      ];
      observer?.retireScreenBundle?.(userId, bundle, retirement);
      for (const [kind, stream] of received)
        removed.push({ userId, kind, stream });
    }
  });
  subjects.push(subject);
  const start = (stream = capture().stream) =>
    subject.startForPeer(2, stream, {
      maxBitrate: 4_000_000,
      codec: 'video/H264',
      onFailure: async () => {
        failures++;
      }
    });
  return {
    subject,
    sent,
    statuses,
    errors,
    streams,
    removed,
    start,
    get failures() {
      return failures;
    }
  };
};

const answer = async (subject: DirectMedia, sessionId = 'outgoing') => {
  await subject.handleSignal(
    event(sessionId, { type: 'answer', sdp: ANSWER, publicKey: 'b'.repeat(64) })
  );
};

const establish = async (subject: TDirectMediaFixture) => {
  const started = subject.start();
  await flush();
  const peer = TestPeer.instances[0]!;
  await answer(subject.subject);
  peer.connect();
  await subject.subject.handleSignal(event('outgoing', { type: 'ready' }));
  expect(await started).toBe('direct');
  return peer;
};

test('a client without the native media bridge falls back instead of attempting browser P2P', async () => {
  replaceGlobal('dodecagonDesktop', undefined);
  const subject = fixture();
  const started = subject.start();
  await flush();
  await clock.advance(8000);
  expect(await started).toBe('relay');
  expect(subject.streams).toEqual([]);
});

test('a timed-out attempt keeps the phase timeline and the failure code', async () => {
  const subject = fixture();
  const started = subject.start();
  await flush();
  await clock.advance(8000);
  expect(await started).toBe('relay');

  const record = getP2PDiagnosticsSnapshot().find(
    (entry) => entry.reason === 'negotiation_timeout'
  );
  expect(record).toMatchObject({
    kind: 'screen',
    role: 'sender',
    outcome: 'relay',
    reason: 'negotiation_timeout'
  });
  expect(record?.phases.map(({ phase }) => phase)).toEqual(
    expect.arrayContaining([
      'attempt',
      'session',
      'native_created',
      'offer_sent'
    ])
  );
  expect(record?.sessionRef).toBe('outgoing');
});

test('a lost native transport falls back once without stopping capture', async () => {
  const subject = fixture();
  const captureStream = capture();
  const started = subject.start(captureStream.stream);
  await flush();
  await answer(subject.subject);
  TestPeer.instances[0]!.connect();
  await subject.subject.handleSignal(event('outgoing', { type: 'ready' }));
  expect(await started).toBe('direct');
  nativeClosed.forEach((notify) => notify({ sessionId: 'outgoing' }));
  await flush();
  expect(subject.failures).toBe(1);
  expect(subject.subject.getConnections()).toEqual([]);
  expect(captureStream.video.readyState).toBe('live');
  expect(captureStream.audio.readyState).toBe('live');
});

test('stopping one native recipient preserves the other established connection', async () => {
  const subject = fixture(async (peerId) => session(`peer-${peerId}`, peerId));
  const media = capture();
  const options = { maxBitrate: 128000, onFailure: async () => {} };
  const first = subject.subject.startForPeer(2, media.stream, options);
  const second = subject.subject.startForPeer(3, media.stream, options);
  await flush();
  for (const [index, userId] of [2, 3].entries()) {
    await subject.subject.handleSignal({
      ...event(`peer-${userId}`, {
        type: 'answer',
        sdp: ANSWER,
        publicKey: 'b'.repeat(64)
      }),
      fromUserId: userId
    });
    TestPeer.instances[index]!.connect();
    await subject.subject.handleSignal({
      ...event(`peer-${userId}`, { type: 'ready' }),
      fromUserId: userId
    });
  }
  expect(await first).toBe('direct');
  expect(await second).toBe('direct');
  subject.subject.stopForPeer(2);
  expect(subject.subject.getConnections().map(({ peerId }) => peerId)).toEqual([
    3
  ]);
  expect(media.video.readyState).toBe('live');
});

describe('DirectMedia outgoing lifecycle', () => {
  test('a group transition before preparation completes preserves server relay eligibility', async () => {
    const pending = deferred<TDirectMediaSession | null>();
    const subject = fixture(() => pending.promise);
    const started = subject.start();
    await flush();
    await subject.subject.handleSignal({
      ...event('group-transition', { type: 'fallback' }),
      relayAllowed: true
    });
    pending.resolve(session('group-transition'));
    await flush();
    expect(await started).toBe('relay');
    expect(TestPeer.instances).toHaveLength(0);
    expect(subject.failures).toBe(0);
  });

  test('replacement waits for a cancelled preparation and its server stop acknowledgement', async () => {
    const prepared = deferred<TDirectMediaSession | null>();
    const stopped = deferred<void>();
    let preparations = 0;
    const value = fixture(
      async () => {
        preparations++;
        return preparations === 1 ? prepared.promise : session('replacement');
      },
      async (sessionId, signal) => {
        if (sessionId === 'cancelled' && signal.type === 'stop')
          await stopped.promise;
      }
    );
    const previous = value.start();
    await flush();
    const replacement = value.start();
    await flush();
    expect(preparations).toBe(1);
    prepared.resolve(session('cancelled'));
    await flush();
    expect(value.sent).toContainEqual({
      sessionId: 'cancelled',
      signal: { type: 'stop' }
    });
    expect(preparations).toBe(1);
    stopped.resolve();
    await flush();
    expect(preparations).toBe(2);
    value.subject.close();
    expect(await previous).toBe('failed');
    expect(await replacement).toBe('failed');
  });

  test('stop cancels prepare and safely retires a late session without opening a peer', async () => {
    const pending = deferred<TDirectMediaSession | null>();
    const subject = fixture(() => pending.promise);
    const media = capture();
    const started = subject.start(media.stream);
    subject.subject.stop();
    expect(await started).toBe('failed');
    pending.resolve(session('late'));
    await flush();
    expect(TestPeer.instances).toHaveLength(0);
    expect(subject.sent).toEqual([
      { sessionId: 'late', signal: { type: 'stop' } }
    ]);
    expect(subject.failures).toBe(0);
    expect(media.video.stopped + media.audio.stopped).toBe(0);
  });

  test('recoverable close tells established viewers to restore relay', async () => {
    const subject = fixture();
    const media = capture();
    const started = subject.start(media.stream);
    await flush();
    await subject.subject.handleSignal(
      event('outgoing', {
        type: 'answer',
        sdp: ANSWER,
        publicKey: 'b'.repeat(64)
      })
    );
    TestPeer.instances[0]!.connect();
    await subject.subject.handleSignal(event('outgoing', { type: 'ready' }));
    expect(await started).toBe('direct');
    subject.subject.close({ restoreRelay: true });
    await flush();
    expect(subject.sent.at(-1)).toEqual({
      sessionId: 'outgoing',
      signal: { type: 'fallback' }
    });
    expect(media.video.readyState).toBe('live');
    expect(media.audio.readyState).toBe('live');
  });

  test('deadline includes prepare and a late response cannot revive a timed-out attempt', async () => {
    const pending = deferred<TDirectMediaSession | null>();
    const subject = fixture(() => pending.promise);
    let result: TDirectMediaResult | undefined;
    const started = subject.start().then((value) => {
      result = value;
      return value;
    });
    await clock.advance(7_999);
    expect(result).toBeUndefined();
    await clock.advance(1);
    expect(await started).toBe('relay');
    pending.resolve(session('late'));
    await flush();
    expect(TestPeer.instances).toHaveLength(0);
    expect(subject.sent).toEqual([
      { sessionId: 'late', signal: { type: 'stop' } }
    ]);
    expect(subject.statuses.at(-1)).toBe('relayed');
  });

  test('server declining direct sharing authorizes relay without a P2P attempt', async () => {
    const subject = fixture(async () => null);
    expect(await subject.start()).toBe('relay');
    expect(TestPeer.instances).toHaveLength(0);
    expect(subject.failures).toBe(0);
  });

  test('native peer construction failure retires the session', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'RTCPeerConnection'
    );
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      value: undefined
    });
    try {
      const subject = fixture();
      const media = capture();
      expect(await subject.start(media.stream)).toBe('relay');
      await flush();
      expect(subject.sent).toEqual([
        { sessionId: 'outgoing', signal: { type: 'fallback' } }
      ]);
      expect(subject.failures).toBe(0);
      expect(media.video.stopped + media.audio.stopped).toBe(0);
    } finally {
      if (descriptor)
        Object.defineProperty(globalThis, 'RTCPeerConnection', descriptor);
    }
  });

  test('prepare rejection fails closed and reports the real error', async () => {
    const error = new Error('prepare failed');
    const subject = fixture(async () => {
      throw error;
    });
    expect(await subject.start()).toBe('relay');
    expect(subject.errors).toContain(error);
    expect(subject.failures).toBe(0);
  });

  test.each(['offer', 'local'] as const)(
    'stop blocks stale %s SDP continuation',
    async (operation) => {
      const pending = deferred<void>();
      TestPeer.plans.push({ [operation]: pending.promise });
      const subject = fixture();
      const started = subject.start();
      await flush();
      subject.subject.stop();
      expect(await started).toBe('failed');
      pending.resolve();
      await flush();
      expect(TestPeer.instances[0]!.connectionState).toBe('closed');
      expect(subject.sent.map(({ signal }) => signal.type)).toEqual(['stop']);
      expect(subject.statuses.at(-1)).toBe('idle');
    }
  );

  test('stop blocks stale remote answer continuation and ready cannot revive it', async () => {
    const pending = deferred<void>();
    TestPeer.plans.push({ remote: pending.promise });
    const subject = fixture();
    const started = subject.start();
    await flush();
    const answering = answer(subject.subject);
    await flush();
    subject.subject.stop();
    expect(await started).toBe('failed');
    pending.resolve();
    await answering;
    TestPeer.instances[0]!.connect();
    await subject.subject.handleSignal(event('outgoing', { type: 'ready' }));
    expect(subject.statuses).not.toContain('direct');
    expect(subject.failures).toBe(0);
  });

  test('waits for both local connected and receiver ready after answer', async () => {
    const subject = fixture();
    let result: TDirectMediaResult | undefined;
    const started = subject.start().then((value) => {
      result = value;
      return value;
    });
    await flush();
    await answer(subject.subject);
    await subject.subject.handleSignal(event('outgoing', { type: 'ready' }));
    expect(result).toBeUndefined();
    TestPeer.instances[0]!.connect();
    expect(await started).toBe('direct');
    expect(subject.statuses.at(-1)).toBe('direct');
  });

  test('a hanging send stays inside the original eight-second deadline', async () => {
    const prepare = deferred<TDirectMediaSession | null>();
    const sending = deferred<void>();
    const subject = fixture(
      () => prepare.promise,
      () => sending.promise
    );
    const started = subject.start();
    await clock.advance(7_000);
    prepare.resolve(session());
    await flush();
    await clock.advance(1_000);
    expect(await started).toBe('relay');
    expect(TestPeer.instances[0]!.connectionState).toBe('closed');
    sending.resolve();
    await flush();
    expect(subject.statuses).not.toContain('direct');
  });

  test('established failure falls back exactly once despite duplicate failure and terminal events', async () => {
    const subject = fixture();
    const media = capture();
    const started = subject.start(media.stream);
    await flush();
    const peer = TestPeer.instances[0]!;
    await answer(subject.subject);
    peer.connect();
    await subject.subject.handleSignal(event('outgoing', { type: 'ready' }));
    expect(await started).toBe('direct');
    peer.connect('failed');
    peer.connect('disconnected');
    await subject.subject.handleSignal(event('outgoing', { type: 'fallback' }));
    await flush();
    expect(subject.failures).toBe(1);
    expect(subject.statuses.at(-1)).toBe('relayed');
    expect(
      subject.sent.filter(({ signal }) => signal.type === 'fallback')
    ).toHaveLength(1);
    expect(media.video.stopped + media.audio.stopped).toBe(0);
  });

  test('mismatched metadata and out-of-order ready do not establish or tear down the paired session', async () => {
    const subject = fixture();
    const started = subject.start();
    await flush();
    const peer = TestPeer.instances[0]!;
    peer.connect();
    await subject.subject.handleSignal(event('outgoing', { type: 'ready' }));
    await subject.subject.handleSignal({
      ...event('outgoing', {
        type: 'answer',
        sdp: ANSWER,
        publicKey: 'b'.repeat(64)
      }),
      fromUserId: 3
    });
    expect(peer.remoteDescription).toBeNull();
    await answer(subject.subject);
    await subject.subject.handleSignal({
      ...event('outgoing', { type: 'fallback' }),
      channelId: 99
    });
    await subject.subject.handleSignal({
      ...event('outgoing', { type: 'fallback' }),
      senderId: 99
    });
    expect(peer.closeCount).toBe(0);
    await subject.subject.handleSignal(event('outgoing', { type: 'ready' }));
    expect(await started).toBe('direct');
  });

  test('restarting does not let a late old prepare stop or replace the new outgoing session', async () => {
    const oldPrepare = deferred<TDirectMediaSession | null>();
    let calls = 0;
    const subject = fixture(() =>
      ++calls === 1 ? oldPrepare.promise : Promise.resolve(session('new'))
    );
    const oldStart = subject.start();
    const newStart = subject.start();
    expect(await oldStart).toBe('failed');
    await flush();
    oldPrepare.resolve(session('old'));
    await flush();
    expect(TestPeer.instances).toHaveLength(1);
    expect(
      subject.sent.some(
        (entry) => entry.sessionId === 'old' && entry.signal.type === 'stop'
      )
    ).toBe(true);
    await answer(subject.subject, 'new');
    TestPeer.instances[0]!.connect();
    await subject.subject.handleSignal(event('new', { type: 'ready' }));
    expect(await newStart).toBe('direct');
  });
});

describe('DirectMedia incoming lifecycle', () => {
  test('only a validated presenter stop retires received media, not fallback', async () => {
    const stopped: number[] = [];
    const subject = fixture(undefined, undefined, undefined, (userId) => {
      stopped.push(userId);
    });
    await subject.subject.handleSignal(
      event(
        'first',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    await subject.subject.handleSignal(
      event('first', { type: 'fallback' }, true)
    );
    expect(stopped).toEqual([]);
    await subject.subject.handleSignal(
      event(
        'second',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    await subject.subject.handleSignal({
      ...event('second', { type: 'stop' }, true),
      fromUserId: 3
    });
    expect(stopped).toEqual([]);
    await subject.subject.handleSignal(event('second', { type: 'stop' }, true));
    expect(stopped).toEqual([2]);
  });

  test('stopping a receiver preserves outgoing capture and other incoming users', async () => {
    const subject = fixture();
    const media = capture();
    const started = subject.start(media.stream);
    await flush();
    await answer(subject.subject);
    const outgoing = TestPeer.instances[0]!;
    outgoing.connect();
    await subject.subject.handleSignal(event('outgoing', { type: 'ready' }));
    expect(await started).toBe('direct');
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    const incoming = TestPeer.instances[1]!;
    const video = new TestTrack('video');
    incoming.receive(video as unknown as MediaStreamTrack);
    incoming.connect();
    await flush();
    await subject.subject.handleSignal({
      ...event(
        'other',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      ),
      senderId: 3,
      fromUserId: 3
    });
    const other = TestPeer.instances[2]!;
    subject.subject.stopReceiving(2);
    await flush();
    expect(incoming.closeCount).toBe(1);
    expect(video.readyState).toBe('ended');
    expect(outgoing.closeCount).toBe(0);
    expect(other.closeCount).toBe(0);
    expect(media.video.stopped + media.audio.stopped).toBe(0);
    expect(subject.removed).toEqual([subject.streams[0]!]);
    expect(subject.failures).toBe(0);
    incoming.receive(new TestTrack('audio') as unknown as MediaStreamTrack);
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    expect(TestPeer.instances).toHaveLength(3);
    expect(subject.streams).toHaveLength(1);
  });

  test('unwatched incoming offers fall back without opening a peer', async () => {
    const subject = fixture(undefined, undefined, () => false);
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    await flush();
    expect(TestPeer.instances).toHaveLength(0);
    expect(subject.streams).toHaveLength(0);
    expect(subject.sent).toEqual([
      { sessionId: 'incoming', signal: { type: 'fallback' } }
    ]);
  });

  test('eligible unwatched offers wait without native peers, media, answers, or a receiver timer', async () => {
    let watching = false;
    const subject = fixture(
      undefined,
      undefined,
      () => watching,
      undefined,
      () => true
    );
    await subject.subject.handleSignal(
      event(
        'pending',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    await clock.advance(7_999);
    expect(TestPeer.instances).toHaveLength(0);
    expect(subject.streams).toEqual([]);
    expect(subject.sent).toEqual([]);
    expect(clock.timers.size).toBe(0);
    expect(subject.subject.acceptPendingOffer(2)).toBe(false);
    watching = true;
    expect(subject.subject.acceptPendingOffer(3)).toBe(false);
    expect(subject.subject.acceptPendingOffer(2)).toBe(true);
    expect(subject.subject.acceptPendingOffer(2)).toBe(false);
    await flush();
    const peer = TestPeer.instances[0]!;
    peer.receive(new TestTrack('video') as unknown as MediaStreamTrack);
    peer.connect();
    await flush();
    expect(
      subject.streams.map(({ userId, kind }) => ({ userId, kind }))
    ).toEqual([{ userId: 2, kind: StreamKind.SCREEN }]);
    expect(subject.sent.at(-1)).toEqual({
      sessionId: 'pending',
      signal: { type: 'ready' }
    });
  });

  test.each(['fallback', 'stop'] as const)(
    'validated pending %s retires the offer and only stop clears the viewing choice',
    async (type) => {
      let watching = false;
      const stopped: number[] = [];
      const subject = fixture(
        undefined,
        undefined,
        () => watching,
        (userId) => {
          stopped.push(userId);
          watching = false;
        },
        () => true
      );
      await subject.subject.handleSignal(
        event(
          'pending',
          { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
          true
        )
      );
      watching = true;
      await subject.subject.handleSignal(event('pending', { type }, true));
      expect(watching).toBe(type === 'fallback');
      expect(stopped).toEqual(type === 'stop' ? [2] : []);
      expect(subject.subject.acceptPendingOffer(2)).toBe(false);
      watching = true;
      await subject.subject.handleSignal(
        event(
          'pending',
          { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
          true
        )
      );
      expect(TestPeer.instances).toHaveLength(0);
      expect(subject.sent).toEqual([]);
    }
  );

  test('duplicate offers and mismatched terminal identities leave the current pending offer available', async () => {
    let watching = false;
    const stopped: number[] = [];
    const subject = fixture(
      undefined,
      undefined,
      () => watching,
      (userId) => stopped.push(userId),
      () => true
    );
    const offer = event(
      'pending',
      { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
      true
    );
    await subject.subject.handleSignal(offer);
    await subject.subject.handleSignal(offer);
    for (const identity of [
      { fromUserId: 3 },
      { senderId: 3 },
      { channelId: 99 }
    ]) {
      await subject.subject.handleSignal({
        ...event('pending', { type: 'stop' }, true),
        ...identity
      });
    }
    expect(stopped).toEqual([]);
    watching = true;
    expect(subject.subject.acceptPendingOffer(2)).toBe(true);
    await flush();
    expect(TestPeer.instances).toHaveLength(1);
  });

  test('replacement retires the old pending session without clearing choice or replacing other presenters', async () => {
    let watching = false;
    const stopped: number[] = [];
    const subject = fixture(
      undefined,
      undefined,
      () => watching,
      (userId) => stopped.push(userId),
      () => true
    );
    await subject.subject.handleSignal(
      event(
        'old',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    await subject.subject.handleSignal({
      ...event(
        'other',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      ),
      fromUserId: 3,
      senderId: 3
    });
    await subject.subject.handleSignal(
      event(
        'current',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    await subject.subject.handleSignal(event('old', { type: 'stop' }, true));
    await subject.subject.handleSignal(
      event(
        'old',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    watching = true;
    expect(subject.subject.acceptPendingOffer(2)).toBe(true);
    expect(subject.subject.acceptPendingOffer(3)).toBe(true);
    await flush();
    expect(stopped).toEqual([]);
    expect(TestPeer.instances).toHaveLength(2);
  });

  test.each(['stopReceiving', 'close'] as const)(
    '%s retires pending offers so renewed consent and late offers cannot resurrect them',
    async (operation) => {
      let watching = false;
      const subject = fixture(
        undefined,
        undefined,
        () => watching,
        undefined,
        () => true
      );
      await subject.subject.handleSignal(
        event(
          'pending',
          { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
          true
        )
      );
      if (operation === 'stopReceiving') subject.subject.stopReceiving(2);
      else subject.subject.close();
      watching = true;
      expect(subject.subject.acceptPendingOffer(2)).toBe(false);
      await subject.subject.handleSignal(
        event(
          'pending',
          { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
          true
        )
      );
      await flush();
      expect(TestPeer.instances).toHaveLength(0);
    }
  );

  test.each(['remote', 'answer', 'local'] as const)(
    'revoked consent cancels accepted pending %s continuation without resurrection',
    async (operation) => {
      let watching = false;
      const pending = deferred<void>();
      const subject = fixture(
        undefined,
        undefined,
        () => watching,
        undefined,
        () => true
      );
      await subject.subject.handleSignal(
        event(
          'pending',
          { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
          true
        )
      );
      TestPeer.plans.push({ [operation]: pending.promise });
      watching = true;
      expect(subject.subject.acceptPendingOffer(2)).toBe(true);
      await flush();
      watching = false;
      pending.resolve();
      await flush();
      watching = true;
      expect(subject.subject.acceptPendingOffer(2)).toBe(false);
      await subject.subject.handleSignal(
        event(
          'pending',
          { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
          true
        )
      );
      expect(TestPeer.instances).toHaveLength(1);
      expect(TestPeer.instances[0]!.connectionState).toBe('closed');
      expect(subject.streams).toEqual([]);
    }
  );

  test('disabled deferral immediately falls back without allowing later consent to reopen the session', async () => {
    let watching = false;
    const subject = fixture(
      undefined,
      undefined,
      () => watching,
      undefined,
      () => false
    );
    await subject.subject.handleSignal(
      event(
        'pending',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    watching = true;
    expect(subject.subject.acceptPendingOffer(2)).toBe(false);
    await subject.subject.handleSignal(
      event(
        'pending',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    await flush();
    expect(TestPeer.instances).toHaveLength(0);
    expect(subject.sent).toEqual([
      { sessionId: 'pending', signal: { type: 'fallback' } }
    ]);
  });

  test('sender deadline retires an unwatched deferred offer without creating receiver media or stopping capture', async () => {
    let watching = false;
    const viewer = fixture(
      undefined,
      undefined,
      () => watching,
      undefined,
      () => true
    );
    const presenter = fixture(undefined, async (sessionId, signal) => {
      await viewer.subject.handleSignal({
        ...event(sessionId, signal, true),
        senderId: 1,
        fromUserId: 1
      });
    });
    const media = capture();
    const started = presenter.start(media.stream);
    await flush();
    expect(TestPeer.instances).toHaveLength(1);
    expect(viewer.sent).toEqual([]);
    expect(viewer.streams).toEqual([]);
    await clock.advance(8_000);
    expect(await started).toBe('relay');
    expect(presenter.statuses.at(-1)).toBe('relayed');
    watching = true;
    expect(viewer.subject.acceptPendingOffer(1)).toBe(false);
    await viewer.subject.handleSignal({
      ...event(
        'outgoing',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      ),
      senderId: 1,
      fromUserId: 1
    });
    expect(TestPeer.instances).toHaveLength(1);
    expect(viewer.streams).toEqual([]);
    expect(media.video.stopped + media.audio.stopped).toBe(0);
  });

  test('retiring a deferred presenter preserves outgoing capture and another watched incoming presenter', async () => {
    const subject = fixture(
      undefined,
      undefined,
      (userId) => userId === 3,
      undefined,
      () => true
    );
    const media = capture();
    const started = subject.start(media.stream);
    await flush();
    const outgoing = TestPeer.instances[0]!;
    await answer(subject.subject);
    outgoing.connect();
    await subject.subject.handleSignal(event('outgoing', { type: 'ready' }));
    expect(await started).toBe('direct');
    await subject.subject.handleSignal(
      event(
        'pending',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    await subject.subject.handleSignal({
      ...event(
        'other',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      ),
      senderId: 3,
      fromUserId: 3
    });
    const other = TestPeer.instances[1]!;
    subject.subject.stopReceiving(2);
    await flush();
    expect(subject.subject.acceptPendingOffer(2)).toBe(false);
    expect(outgoing.closeCount).toBe(0);
    expect(other.closeCount).toBe(0);
    expect(TestPeer.instances).toHaveLength(2);
    expect(media.video.stopped + media.audio.stopped).toBe(0);
    expect(subject.failures).toBe(0);
  });

  test.each(['fallback', 'stop'] as const)(
    'unknown %s before an offer prevents its later deferral or acceptance',
    async (type) => {
      let watching = false;
      const stopped: number[] = [];
      const subject = fixture(
        undefined,
        undefined,
        () => watching,
        (userId) => stopped.push(userId),
        () => true
      );
      await subject.subject.handleSignal(event('late', { type }, true));
      await subject.subject.handleSignal(
        event(
          'late',
          { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
          true
        )
      );
      watching = true;
      expect(subject.subject.acceptPendingOffer(2)).toBe(false);
      expect(stopped).toEqual([]);
      expect(TestPeer.instances).toHaveLength(0);
      expect(subject.sent).toEqual([]);
    }
  );

  test.each(['remote', 'answer', 'local'] as const)(
    'revoked demo permission cancels incoming %s continuation',
    async (operation) => {
      let watching = true;
      const pending = deferred<void>();
      TestPeer.plans.push({ [operation]: pending.promise });
      const subject = fixture(undefined, undefined, () => watching);
      const handling = subject.subject.handleSignal(
        event(
          'incoming',
          { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
          true
        )
      );
      await flush();
      watching = false;
      pending.resolve();
      await handling;
      await flush();
      expect(TestPeer.instances[0]!.closeCount).toBe(1);
      expect(subject.streams).toHaveLength(0);
    }
  );

  test('incoming microphone media waits for delivered RTP before it is presented and reported ready', async () => {
    const delivery = deferred<RTCStatsReport>();
    const subject = fixture(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      StreamKind.AUDIO
    );
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true,
        StreamKind.AUDIO
      )
    );
    await flush();
    const peer = TestPeer.instances[0]!;
    peer.connect();
    peer.receive(
      new TestTrack('audio') as unknown as MediaStreamTrack,
      delivery.promise
    );
    await flush();

    expect(subject.streams).toEqual([]);
    expect(subject.sent.some(({ signal }) => signal.type === 'ready')).toBe(
      false
    );

    delivery.resolve(deliveredStats('audio'));
    await flush();
    await clock.advance(60);

    expect(subject.streams).toHaveLength(1);
    expect(subject.streams[0]!.kind).toBe(StreamKind.AUDIO);
    expect(subject.sent.at(-1)?.signal).toEqual({ type: 'ready' });
  });

  test('incoming microphone media that never delivers is never presented', async () => {
    const delivery = deferred<RTCStatsReport>();
    const subject = fixture(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      StreamKind.AUDIO
    );
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true,
        StreamKind.AUDIO
      )
    );
    await flush();
    const peer = TestPeer.instances[0]!;
    peer.connect();
    peer.receive(
      new TestTrack('audio') as unknown as MediaStreamTrack,
      delivery.promise
    );
    await flush();
    await clock.advance(5000);

    expect(subject.streams).toEqual([]);
    expect(subject.sent.at(-1)?.signal).toEqual({ type: 'fallback' });
  });

  test('revoked demo permission denies late incoming tracks', async () => {
    let watching = true;
    const subject = fixture(undefined, undefined, () => watching);
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    watching = false;
    TestPeer.instances[0]!.receive(
      new TestTrack('video') as unknown as MediaStreamTrack
    );
    await flush();
    expect(TestPeer.instances[0]!.closeCount).toBe(1);
    expect(subject.streams).toHaveLength(0);
  });

  test('screen reception keeps the relay bundle until both direct receivers deliver and restores it before retiring direct tracks', async () => {
    type TScreenBundle = {
      screen: MediaStream;
      screenAudio: MediaStream;
    };
    const relayBundle: TScreenBundle = {
      screen: new TestStream([
        new TestTrack('video') as unknown as MediaStreamTrack
      ]) as unknown as MediaStream,
      screenAudio: new TestStream([
        new TestTrack('audio') as unknown as MediaStreamTrack
      ]) as unknown as MediaStream
    };
    const directStreams = new Map<StreamKind, MediaStream>();
    const restoredBeforeRetirement: boolean[] = [];
    const fallbackRpc = deferred<void>();
    let directBundle: TScreenBundle | undefined;
    let presentation = relayBundle;
    const screenOffer = `${OFFER}m=video 9 UDP/TLS/RTP/SAVPF 96\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n`;
    const subject = fixture(
      undefined,
      async (_, signal) => {
        if (signal.type === 'fallback') await fallbackRpc.promise;
      },
      () => true,
      undefined,
      undefined,
      {
        presentScreenBundle: (_, bundle) => {
          directStreams.set(StreamKind.SCREEN, bundle.screen);
          directStreams.set(StreamKind.SCREEN_AUDIO, bundle.screenAudio!);
          directBundle = {
            screen: bundle.screen,
            screenAudio: bundle.screenAudio!
          };
          presentation = directBundle;
        },
        retireScreenBundle: () => {
          if (presentation === relayBundle) return;
          restoredBeforeRetirement.push(
            [...directStreams.values()].every((stream) =>
              stream.getTracks().every((track) => track.readyState === 'live')
            )
          );
          presentation = relayBundle;
        }
      }
    );
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: screenOffer, publicKey: 'a'.repeat(64) },
        true
      )
    );
    const peer = TestPeer.instances[0]!;
    const audioInbound = {
      id: 'audio',
      timestamp: 1,
      type: 'inbound-rtp',
      kind: 'audio',
      mediaType: 'audio',
      packetsReceived: 0,
      totalSamplesReceived: 0,
      jitterBufferEmittedCount: 0
    };
    const videoInbound = {
      id: 'video',
      timestamp: 1,
      type: 'inbound-rtp',
      kind: 'video',
      mediaType: 'video',
      packetsReceived: 1,
      framesDecoded: 0
    };
    const audio = new TestTrack('audio');
    const video = new TestTrack('video');
    peer.receive(
      audio as unknown as MediaStreamTrack,
      Promise.resolve(
        new Map([['audio', audioInbound]]) as unknown as RTCStatsReport
      )
    );
    peer.receive(
      video as unknown as MediaStreamTrack,
      Promise.resolve(
        new Map([['video', videoInbound]]) as unknown as RTCStatsReport
      )
    );
    peer.connect();
    await flush();

    expect(presentation).toBe(relayBundle);
    expect(subject.sent.map(({ signal }) => signal.type)).toEqual(['answer']);

    videoInbound.framesDecoded = 1;
    peer.connect();
    await flush();
    expect(presentation).toBe(relayBundle);
    expect(subject.sent.map(({ signal }) => signal.type)).toEqual(['answer']);

    audioInbound.packetsReceived = 1;
    peer.connect();
    await flush();

    expect(subject.sent.map(({ signal }) => signal.type)).toEqual([
      'answer',
      'ready'
    ]);
    expect(directBundle).toBeDefined();
    if (!directBundle) throw new Error('Expected a presented direct bundle');
    const directScreen = directStreams.get(StreamKind.SCREEN);
    const directScreenAudio = directStreams.get(StreamKind.SCREEN_AUDIO);
    if (!directScreen || !directScreenAudio) {
      throw new Error('Expected both direct screen streams');
    }
    expect(presentation).toBe(directBundle);
    expect(directBundle).toEqual({
      screen: directScreen,
      screenAudio: directScreenAudio
    });

    nativeClosed.forEach((notify) => notify({ sessionId: 'incoming' }));
    await flush();
    expect(presentation).toBe(relayBundle);
    expect(restoredBeforeRetirement).toEqual([true]);
    expect(video.readyState).toBe('ended');
    expect(audio.readyState).toBe('ended');
    expect(subject.removed).toHaveLength(2);
    expect(subject.removed.map(({ stream }) => stream)).toContain(directScreen);
    expect(subject.removed.map(({ stream }) => stream)).toContain(
      directScreenAudio
    );

    const fallbackError = new Error('fallback delayed then rejected');
    fallbackRpc.reject(fallbackError);
    await flush();
    expect(subject.errors).toContain(fallbackError);
    expect(presentation).toBe(relayBundle);
  });

  test('incoming ready waits for answer send completion even if video and connection arrive first', async () => {
    const sending = deferred<void>();
    const subject = fixture(undefined, async (_, signal) => {
      if (signal.type === 'answer') await sending.promise;
    });
    const handling = subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    await flush();
    const peer = TestPeer.instances[0]!;
    peer.receive(new TestTrack('video') as unknown as MediaStreamTrack);
    peer.connect();
    await flush();
    expect(subject.sent.map(({ signal }) => signal.type)).toEqual(['answer']);
    sending.resolve();
    await handling;
    await flush();
    expect(subject.sent.map(({ signal }) => signal.type)).toEqual([
      'answer',
      'ready'
    ]);
  });

  test.each(['remote', 'answer', 'local'] as const)(
    'terminal stop cancels stale incoming %s continuation',
    async (operation) => {
      const pending = deferred<void>();
      TestPeer.plans.push({ [operation]: pending.promise });
      const subject = fixture();
      const handling = subject.subject.handleSignal(
        event(
          'incoming',
          { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
          true
        )
      );
      await flush();
      await subject.subject.handleSignal(
        event('incoming', { type: 'stop' }, true)
      );
      pending.resolve();
      await handling;
      expect(TestPeer.instances[0]!.closeCount).toBe(1);
      expect(subject.sent).toHaveLength(0);
      await subject.subject.handleSignal(
        event(
          'incoming',
          { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
          true
        )
      );
      expect(TestPeer.instances).toHaveLength(1);
    }
  );

  test('incoming answer failure retires privately staged media and notifies sender', async () => {
    const error = new Error('answer failed');
    const sending = deferred<void>();
    const subject = fixture(undefined, async (_, signal) => {
      if (signal.type === 'answer') await sending.promise;
    });
    const handling = subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    await flush();
    const peer = TestPeer.instances[0]!;
    const video = new TestTrack('video');
    peer.receive(video as unknown as MediaStreamTrack);
    sending.reject(error);
    await handling;
    expect(peer.connectionState).toBe('closed');
    expect(video.readyState).toBe('ended');
    expect(subject.streams).toEqual([]);
    expect(subject.removed).toEqual([]);
    expect(subject.errors).toContain(error);
    expect(subject.sent.at(-1)).toEqual({
      sessionId: 'incoming',
      signal: { type: 'fallback' }
    });
  });

  test('incoming connection failure notifies sender once and removes only its own direct stream identities', async () => {
    const subject = fixture();
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    const peer = TestPeer.instances[0]!;
    peer.receive(new TestTrack('video') as unknown as MediaStreamTrack);
    peer.receive(new TestTrack('audio') as unknown as MediaStreamTrack);
    peer.connect();
    await flush();
    peer.connect('failed');
    peer.connect('failed');
    await flush();
    expect(
      subject.sent.filter(({ signal }) => signal.type === 'fallback')
    ).toHaveLength(1);
    expect(subject.removed).toHaveLength(2);
    for (const removed of subject.removed) {
      expect(
        subject.streams.some(
          (stream) =>
            stream.stream === removed.stream && stream.kind === removed.kind
        )
      ).toBe(true);
    }
  });

  test('incoming attempts time out and close without stopping an independent outgoing session', async () => {
    const subject = fixture();
    const outgoing = await establish(subject);
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    const incoming = TestPeer.instances[1]!;
    await clock.advance(8_000);
    expect(incoming.connectionState).toBe('closed');
    expect(outgoing.closeCount).toBe(0);
    expect(subject.failures).toBe(0);
    expect(subject.sent.at(-1)).toEqual({
      sessionId: 'incoming',
      signal: { type: 'fallback' }
    });
  });

  test('stop closes only outgoing; close removes incoming and never stops original capture', async () => {
    const subject = fixture();
    const media = capture();
    const started = subject.start(media.stream);
    await flush();
    await answer(subject.subject);
    TestPeer.instances[0]!.connect();
    await subject.subject.handleSignal(event('outgoing', { type: 'ready' }));
    expect(await started).toBe('direct');
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    const incoming = TestPeer.instances[1]!;
    incoming.receive(new TestTrack('video') as unknown as MediaStreamTrack);
    incoming.connect();
    await flush();
    subject.subject.stop();
    expect(TestPeer.instances[0]!.connectionState).toBe('closed');
    expect(incoming.closeCount).toBe(0);
    expect(subject.removed).toHaveLength(0);
    subject.subject.close();
    expect(incoming.connectionState).toBe('closed');
    expect(subject.removed[0]!.stream).toBe(subject.streams[0]!.stream);
    expect(media.video.stopped + media.audio.stopped).toBe(0);
    expect(subject.failures).toBe(0);
  });

  test('stale events cannot remove a new stream or reopen a retired incoming session', async () => {
    const subject = fixture();
    await subject.subject.handleSignal(
      event(
        'old',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    const oldPeer = TestPeer.instances[0]!;
    oldPeer.receive(new TestTrack('video') as unknown as MediaStreamTrack);
    oldPeer.connect();
    await flush();
    await subject.subject.handleSignal(
      event('old', { type: 'fallback' }, true)
    );
    await subject.subject.handleSignal(
      event(
        'new',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    const newPeer = TestPeer.instances[1]!;
    newPeer.receive(new TestTrack('video') as unknown as MediaStreamTrack);
    newPeer.connect();
    await flush();
    const replacement = subject.streams[1]!.stream;
    await subject.subject.handleSignal(event('old', { type: 'stop' }, true));
    await subject.subject.handleSignal(
      event(
        'old',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    oldPeer.connect('failed');
    oldPeer.receive(new TestTrack('audio') as unknown as MediaStreamTrack);
    expect(TestPeer.instances).toHaveLength(2);
    expect(newPeer.closeCount).toBe(0);
    expect(subject.removed).toHaveLength(1);
    expect(subject.removed[0]!.stream).not.toBe(replacement);
    expect(subject.streams).toHaveLength(2);
  });

  test('duplicate offers and mismatched terminal identities cannot replace or close incoming peers', async () => {
    const subject = fixture();
    await subject.subject.handleSignal({
      ...event(
        'bad',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      ),
      fromUserId: 3
    });
    expect(TestPeer.instances).toHaveLength(0);
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    await subject.subject.handleSignal({
      ...event('incoming', { type: 'stop' }, true),
      fromUserId: 3
    });
    await subject.subject.handleSignal({
      ...event('incoming', { type: 'stop' }, true),
      channelId: 99
    });
    expect(TestPeer.instances).toHaveLength(1);
    expect(TestPeer.instances[0]!.closeCount).toBe(0);
  });

  test('close before voice initialization allows a fresh outgoing and incoming share', async () => {
    const subject = fixture();
    subject.subject.close();
    const started = subject.start();
    await flush();
    await subject.subject.handleSignal(
      event(
        'incoming',
        { type: 'offer', sdp: OFFER, publicKey: 'a'.repeat(64) },
        true
      )
    );
    expect(TestPeer.instances).toHaveLength(2);
    await answer(subject.subject);
    TestPeer.instances[0]!.connect();
    await subject.subject.handleSignal(event('outgoing', { type: 'ready' }));
    expect(await started).toBe('direct');
    expect(TestPeer.instances[1]!.closeCount).toBe(0);
  });

  test('close cancels an old prepare without blocking fresh sessions or reviving the late result', async () => {
    const pending = deferred<TDirectMediaSession | null>();
    let calls = 0;
    const subject = fixture(() =>
      ++calls === 1 ? pending.promise : Promise.resolve(session('fresh'))
    );
    const oldStart = subject.start();
    subject.subject.close();
    expect(await oldStart).toBe('failed');
    const freshStart = subject.start();
    await flush();
    pending.resolve(session('late'));
    await flush();
    expect(TestPeer.instances).toHaveLength(1);
    expect(
      subject.sent.some(
        ({ sessionId, signal }) =>
          sessionId === 'late' && signal.type === 'stop'
      )
    ).toBe(true);
    await answer(subject.subject, 'fresh');
    TestPeer.instances[0]!.connect();
    await subject.subject.handleSignal(event('fresh', { type: 'ready' }));
    expect(await freshStart).toBe('direct');
  });
});

test('a stalled recipient cannot consume another recipient connection deadline', async () => {
  const blocked = deferred<TDirectMediaSession | null>();
  const subject = fixture((peerId) =>
    peerId === 2 ? blocked.promise : Promise.resolve(session('healthy', 3))
  );
  const media = capture();
  const options = { maxBitrate: 128000, onFailure: async () => {} };
  const first = subject.subject.startForPeer(2, media.stream, options);
  const second = subject.subject.startForPeer(3, media.stream, options);
  await flush();
  const healthy = TestPeer.instances[0];
  if (healthy) {
    await subject.subject.handleSignal({
      ...event('healthy', {
        type: 'answer',
        sdp: ANSWER,
        publicKey: 'b'.repeat(64)
      }),
      fromUserId: 3
    });
    healthy.connect();
    await subject.subject.handleSignal({
      ...event('healthy', { type: 'ready' }),
      fromUserId: 3
    });
  }
  await clock.advance(8000);
  expect(await second).toBe('direct');
  blocked.resolve(null);
  await first;
});
