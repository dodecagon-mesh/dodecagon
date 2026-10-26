import {
  StreamKind,
  type AppRouter,
  type TProducibleStreamKind
} from '@dodecagon/shared';
import { createTRPCProxyClient, createWSClient, wsLink } from '@trpc/client';
import { Device } from 'mediasoup-client';
import type { Transport } from 'mediasoup-client/types';
import { expect, test } from 'vitest';

const delay = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const connect = async (identity: string) => {
  const host = `localhost:${VITE_SERVER_PORT}`;
  const response = await fetch(`http://${host}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password: 'password123' })
  });
  expect(response.ok).toBe(true);
  const { token } = await response.json();
  const socket = createWSClient({
    url: `ws://${host}`,
    connectionParams: { token }
  });
  const client = createTRPCProxyClient<AppRouter>({
    links: [wsLink({ client: socket })]
  });
  const { handshakeHash } = await client.others.handshake.query();
  await client.others.joinServer.query({ handshakeHash });
  return { client, socket };
};

test('a late screen viewer keeps one relay stream through direct fallback', async () => {
  const publisher = await connect('rnd332');
  const viewer = await connect('aria');
  const transports: Transport[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d')!;
  let count = 0;
  const animation = setInterval(() => {
    context.fillStyle = count++ % 2 ? '#39c5cf' : '#e8488d';
    context.fillRect(0, 0, 320, 180);
  }, 30);
  const source = canvas.captureStream(30);
  const sound = new AudioContext();
  const oscillator = sound.createOscillator();
  const destination = sound.createMediaStreamDestination();
  oscillator.connect(destination);
  oscillator.start();
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  document.body.append(video);
  try {
    const joining = {
      channelId: 2,
      state: { micMuted: false, soundMuted: false }
    };
    const [publisherJoin, viewerJoin] = await Promise.all([
      publisher.client.voice.join.mutate(joining),
      viewer.client.voice.join.mutate(joining)
    ]);
    const sendDevice = new Device();
    const receiveDevice = new Device();
    await Promise.all([
      sendDevice.load({
        routerRtpCapabilities: publisherJoin.routerRtpCapabilities
      }),
      receiveDevice.load({
        routerRtpCapabilities: viewerJoin.routerRtpCapabilities
      })
    ]);
    const send = sendDevice.createSendTransport(
      await publisher.client.voice.createProducerTransport.mutate()
    );
    const receive = receiveDevice.createRecvTransport(
      await viewer.client.voice.createConsumerTransport.mutate()
    );
    transports.push(send, receive);
    send.on('connect', ({ dtlsParameters }, done, fail) => {
      publisher.client.voice.connectProducerTransport
        .mutate({ dtlsParameters })
        .then(done, fail);
    });
    receive.on('connect', ({ dtlsParameters }, done, fail) => {
      viewer.client.voice.connectConsumerTransport
        .mutate({ dtlsParameters })
        .then(done, fail);
    });
    send.on('produce', ({ rtpParameters, appData }, done, fail) => {
      publisher.client.voice.produce
        .mutate({
          transportId: send.id,
          kind: appData.kind as TProducibleStreamKind,
          rtpParameters
        })
        .then((id) => done({ id }), fail);
    });
    await send.produce({
      track: destination.stream.getAudioTracks()[0],
      appData: { kind: StreamKind.AUDIO }
    });
    const audio = await viewer.client.voice.consume.mutate({
      remoteId: 1,
      kind: StreamKind.AUDIO,
      rtpCapabilities: receiveDevice.rtpCapabilities
    });
    await receive.consume({
      id: audio.consumerId,
      producerId: audio.producerId,
      kind: 'audio',
      rtpParameters: audio.consumerRtpParameters
    });
    await expect.poll(() => receive.connectionState).toBe('connected');
    const screenProducer = await send.produce({
      track: source.getVideoTracks()[0],
      appData: { kind: StreamKind.SCREEN }
    });
    const parameters = await viewer.client.voice.consume.mutate({
      remoteId: 1,
      kind: StreamKind.SCREEN,
      rtpCapabilities: receiveDevice.rtpCapabilities
    });
    // a connected receiver must not spend its first keyframe before native receive exists.
    await delay(300);
    const consumer = await receive.consume({
      id: parameters.consumerId,
      producerId: parameters.producerId,
      kind: 'video',
      rtpParameters: parameters.consumerRtpParameters
    });
    video.srcObject = new MediaStream([consumer.track]);
    const decoded = Promise.withResolvers<number>();
    video.requestVideoFrameCallback(() => decoded.resolve(performance.now()));
    const playing = video.play();
    const start = performance.now();
    await viewer.client.voice.resumeConsumer.mutate({
      remoteId: 1,
      kind: StreamKind.SCREEN,
      consumerId: consumer.id
    });
    const firstFrameDeadline = Promise.withResolvers<never>();
    const firstFrameTimer = setTimeout(
      () =>
        firstFrameDeadline.reject(new Error('No decoded first screen frame')),
      2000
    );
    const firstFrame = await Promise.race([
      decoded.promise,
      firstFrameDeadline.promise
    ]);
    clearTimeout(firstFrameTimer);
    await playing;
    const elapsed = firstFrame - start;
    console.info('real SFU first screen frame ms:', Math.round(elapsed));
    expect(elapsed).toBeLessThan(1500);
    expect(video.videoWidth).toBe(320);
    const stats = await consumer.getStats();
    expect(
      [...stats.values()].some(
        (entry) => entry.type === 'inbound-rtp' && entry.framesDecoded > 0
      )
    ).toBe(true);
    const inboundFrames = async () => {
      const record = [...(await consumer.getStats()).values()].find(
        (entry) => entry.type === 'inbound-rtp' && entry.kind === 'video'
      );
      return typeof record?.framesDecoded === 'number'
        ? record.framesDecoded
        : 0;
    };
    const publisherDirectStarted = Promise.withResolvers<void>();
    const viewerDirectStarted = Promise.withResolvers<void>();
    const demandStarted = Promise.withResolvers<void>();
    const producerEventsStarted = Promise.withResolvers<void>();
    const publisherDirect =
      publisher.client.voice.onDirectMediaSignal.subscribe(
        { enabled: true, transport: 'holepunch' },
        {
          onStarted: () => publisherDirectStarted.resolve(),
          onData: () => {},
          onError: publisherDirectStarted.reject
        }
      );
    const viewerDirect = viewer.client.voice.onDirectMediaSignal.subscribe(
      { enabled: true, transport: 'holepunch' },
      {
        onStarted: () => viewerDirectStarted.resolve(),
        onData: () => {},
        onError: viewerDirectStarted.reject
      }
    );
    const relayDemand = publisher.client.voice.onRelayDemand.subscribe(
      undefined,
      {
        onStarted: () => demandStarted.resolve(),
        onData: ({ kind, required }) => {
          if (kind !== StreamKind.SCREEN) return;
          if (required && screenProducer.paused) screenProducer.resume();
          else if (!required && !screenProducer.paused) screenProducer.pause();
        },
        onError: demandStarted.reject
      }
    );
    const announcedKinds: StreamKind[] = [];
    const producerEvents = viewer.client.voice.onNewProducer.subscribe(
      undefined,
      {
        onStarted: () => producerEventsStarted.resolve(),
        onData: ({ kind }) => announcedKinds.push(kind),
        onError: producerEventsStarted.reject
      }
    );
    await Promise.all([
      publisherDirectStarted.promise,
      viewerDirectStarted.promise,
      demandStarted.promise,
      producerEventsStarted.promise
    ]);

    const session = await publisher.client.voice.startDirectMedia.mutate({
      kind: StreamKind.SCREEN,
      peerId: 2
    });
    if (!session) throw new Error('Expected direct screen session');
    const sdp = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n';
    await publisher.client.voice.signalDirectMedia.mutate({
      sessionId: session.sessionId,
      signal: { type: 'offer', sdp, publicKey: 'a'.repeat(64) }
    });
    await viewer.client.voice.signalDirectMedia.mutate({
      sessionId: session.sessionId,
      signal: { type: 'answer', sdp, publicKey: 'b'.repeat(64) }
    });
    await viewer.client.voice.signalDirectMedia.mutate({
      sessionId: session.sessionId,
      signal: { type: 'ready' }
    });
    await expect
      .poll(() => screenProducer.paused, { timeout: 1_000, interval: 10 })
      .toBe(true);
    await delay(150);
    const pausedFrames = await inboundFrames();
    const originalTrack = consumer.track;
    const fallbackStartedAt = performance.now();

    await viewer.client.voice.signalDirectMedia.mutate({
      sessionId: session.sessionId,
      signal: { type: 'fallback' }
    });
    await expect
      .poll(() => screenProducer.paused, { timeout: 1_000, interval: 10 })
      .toBe(false);
    await expect
      .poll(inboundFrames, { timeout: 1_500, interval: 20 })
      .toBeGreaterThan(pausedFrames);

    expect(performance.now() - fallbackStartedAt).toBeLessThan(1_500);
    expect(consumer.id).toBe(parameters.consumerId);
    expect(consumer.closed).toBe(false);
    expect(consumer.track).toBe(originalTrack);
    expect(announcedKinds).not.toContain(StreamKind.SCREEN);

    producerEvents.unsubscribe();
    relayDemand.unsubscribe();
    viewerDirect.unsubscribe();
    publisherDirect.unsubscribe();
  } finally {
    clearInterval(animation);
    source.getTracks().forEach((track) => track.stop());
    destination.stream.getTracks().forEach((track) => track.stop());
    oscillator.stop();
    await sound.close();
    video.remove();
    transports.forEach((transport) => transport.close());
    await Promise.allSettled([
      publisher.client.voice.leave.mutate(),
      viewer.client.voice.leave.mutate()
    ]);
    publisher.socket.close();
    viewer.socket.close();
  }
}, 15000);
