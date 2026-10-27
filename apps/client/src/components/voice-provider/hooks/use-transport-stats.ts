import { logVoice, logVoiceError } from '@/helpers/browser-logger';
import { getTRPCClient } from '@/lib/trpc';
import { StreamKind } from '@dodecagon/shared';
import type { AppData, Producer, Transport } from 'mediasoup-client/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirectMedia } from '../direct-media';

export type TransportStats = {
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
  packetsLost: number;
  rtt: number;
  jitter: number;
  timestamp: number;
};

export type ScreenShareStats = {
  codec: string;
  encoderImplementation: string;
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
  packetsSent: number;
  bytesSent: number;
  keyFramesEncoded: number;
  framesEncoded: number;
  qualityLimitationReason: string;
  simulcast: boolean;
  layers: ScreenShareLayerStats[];
  timestamp: number;
};

export type ScreenShareLayerStats = {
  id: string;
  rid: string;
  codec: string;
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
  packetsSent: number;
  bytesSent: number;
  keyFramesEncoded: number;
  framesEncoded: number;
  qualityLimitationReason: string;
};

type ParsedScreenShareStats = Omit<ScreenShareStats, 'bitrate' | 'layers'> & {
  layers: Omit<ScreenShareLayerStats, 'bitrate'>[];
};

export type TransportStatsData = {
  serverRtt: number | null;
  peerRtts: Record<number, number | null>;
  direct: TransportStats | null;
  producer: TransportStats | null;
  consumer: TransportStats | null;
  screenShare: ScreenShareStats | null;
  totalBytesReceived: number;
  totalBytesSent: number;
  currentBitrateSent: number;
  currentBitrateReceived: number;
};

// A request cannot be cancelled. Keep its slot until it settles, including
// across polling restarts and hook remounts; never accumulate timed-out calls.
const pendingStatsRequests = new WeakMap<
  Transport | Producer<AppData> | RTCPeerConnection,
  Promise<RTCStatsReport>
>();

const pendingControlPings = new WeakMap<
  ReturnType<typeof getTRPCClient>,
  Promise<number>
>();

const getStats = (
  target: Transport | Producer<AppData> | RTCPeerConnection
) => {
  const pending = pendingStatsRequests.get(target);
  if (pending) return pending;

  const request = Promise.resolve()
    .then(() => target.getStats())
    .finally(() => pendingStatsRequests.delete(target));
  pendingStatsRequests.set(target, request);
  return request;
};

const selectedRtt = (report: RTCStatsReport): number | null => {
  let rtt: number | null = null;
  for (const stat of report.values()) {
    if (stat.type !== 'transport' || !stat.selectedCandidatePairId) continue;
    const pair = report.get(stat.selectedCandidatePairId);
    if (
      pair?.type !== 'candidate-pair' ||
      pair.state !== 'succeeded' ||
      typeof pair.currentRoundTripTime !== 'number' ||
      !Number.isFinite(pair.currentRoundTripTime) ||
      pair.currentRoundTripTime < 0
    )
      continue;
    rtt = Math.max(rtt ?? 0, pair.currentRoundTripTime * 1000);
  }
  return rtt;
};

const useTransportStats = (
  directSources: Pick<DirectMedia, 'getConnections'>[] = []
) => {
  const directSourcesRef = useRef(directSources);
  directSourcesRef.current = directSources;
  const previousDirectStatsRef = useRef(
    new WeakMap<RTCPeerConnection, TransportStats>()
  );
  const controlPendingRef = useRef<{
    client: ReturnType<typeof getTRPCClient>;
    request: Promise<number>;
  } | null>(null);
  const controlMeasurementRef = useRef<{
    rtt: number;
    timestamp: number;
  } | null>(null);
  const [stats, setStats] = useState<TransportStatsData>({
    serverRtt: null,
    peerRtts: {},
    direct: null,
    producer: null,
    consumer: null,
    screenShare: null,
    totalBytesReceived: 0,
    totalBytesSent: 0,
    currentBitrateSent: 0,
    currentBitrateReceived: 0
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const monitoringRef = useRef(false);
  const generationRef = useRef(0);
  const collectingRef = useRef<number | null>(null);
  const intervalMsRef = useRef(1000);
  const subscriberCountRef = useRef(0);
  const producerTransportRef = useRef<Transport | null>(null);
  const consumerTransportRef = useRef<Transport | null>(null);
  const screenShareProducerRef = useRef<Producer<AppData> | null>(null);
  const previousStatsRef = useRef<{
    producer: TransportStats | null;
    consumer: TransportStats | null;
  }>({
    producer: null,
    consumer: null
  });
  const previousScreenShareStatsRef = useRef<{
    target: Producer<AppData> | RTCPeerConnection;
    bytesSent: number;
    layerBytesSent: Map<string, number>;
    timestamp: number;
  } | null>(null);

  const parseTransportStats = useCallback(
    (statsReport: RTCStatsReport, isProducer: boolean): TransportStats => {
      let bytesReceived = 0;
      let bytesSent = 0;
      let packetsReceived = 0;
      let packetsSent = 0;
      let packetsLost = 0;
      let rtt = 0;
      let jitter = 0;

      for (const stat of statsReport.values()) {
        if (stat.type === 'outbound-rtp' && isProducer) {
          bytesSent += stat.bytesSent || 0;
          packetsSent += stat.packetsSent || 0;
        } else if (stat.type === 'inbound-rtp' && !isProducer) {
          bytesReceived += stat.bytesReceived || 0;
          packetsReceived += stat.packetsReceived || 0;
          packetsLost += stat.packetsLost || 0;
          jitter += stat.jitter || 0;
        } else if (
          stat.type === 'candidate-pair' &&
          stat.state === 'succeeded'
        ) {
          rtt = (stat.currentRoundTripTime || 0) * 1000;
        }
      }

      return {
        bytesReceived,
        bytesSent,
        packetsReceived,
        packetsSent,
        packetsLost,
        rtt,
        jitter,
        timestamp: Date.now()
      };
    },
    []
  );

  const parseScreenShareStats = useCallback(
    (statsReport: RTCStatsReport): ParsedScreenShareStats | null => {
      let codec = '';
      let encoderImplementation = '';
      let width = 0;
      let height = 0;
      let frameRate = 0;
      let packetsSent = 0;
      let bytesSent = 0;
      let keyFramesEncoded = 0;
      let framesEncoded = 0;
      let qualityLimitationReason = 'none';

      const codecMap = new Map<string, string>();
      const layers: Omit<ScreenShareLayerStats, 'bitrate'>[] = [];

      for (const stat of statsReport.values()) {
        if (stat.type === 'codec') {
          codecMap.set(stat.id, stat.mimeType || '');
        }
      }

      for (const stat of statsReport.values()) {
        if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
          const layerBytesSent = stat.bytesSent || 0;
          const layerPacketsSent = stat.packetsSent || 0;
          const layerFrameRate = stat.framesPerSecond || 0;
          const layerWidth = stat.frameWidth || 0;
          const layerHeight = stat.frameHeight || 0;
          const layerKeyFramesEncoded = stat.keyFramesEncoded || 0;
          const layerFramesEncoded = stat.framesEncoded || 0;
          const layerQualityLimitationReason =
            stat.qualityLimitationReason || 'none';
          const layerCodec =
            stat.codecId && codecMap.has(stat.codecId)
              ? codecMap.get(stat.codecId)!
              : '';

          bytesSent += layerBytesSent;
          packetsSent += layerPacketsSent;
          frameRate = Math.max(frameRate, layerFrameRate);
          width = Math.max(width, layerWidth);
          height = Math.max(height, layerHeight);
          keyFramesEncoded += layerKeyFramesEncoded;
          framesEncoded += layerFramesEncoded;

          if (layerQualityLimitationReason !== 'none') {
            qualityLimitationReason = layerQualityLimitationReason;
          }

          if (!encoderImplementation && stat.encoderImplementation) {
            encoderImplementation = stat.encoderImplementation;
          }

          if (stat.codecId && codecMap.has(stat.codecId)) {
            codec = codecMap.get(stat.codecId)!;
          }

          layers.push({
            id: stat.id,
            rid: stat.rid || stat.id,
            codec: layerCodec,
            width: layerWidth,
            height: layerHeight,
            frameRate: layerFrameRate,
            packetsSent: layerPacketsSent,
            bytesSent: layerBytesSent,
            keyFramesEncoded: layerKeyFramesEncoded,
            framesEncoded: layerFramesEncoded,
            qualityLimitationReason: layerQualityLimitationReason
          });
        }
      }

      if (!width && !height && !bytesSent) {
        return null;
      }

      return {
        codec,
        encoderImplementation,
        width,
        height,
        frameRate,
        packetsSent,
        bytesSent,
        keyFramesEncoded,
        framesEncoded,
        qualityLimitationReason,
        simulcast: layers.length > 1,
        layers,
        timestamp: Date.now()
      };
    },
    []
  );

  const collectStats = useCallback(async () => {
    const generation = generationRef.current;
    if (collectingRef.current === generation) return;
    const producerTransport = producerTransportRef.current;
    const consumerTransport = consumerTransportRef.current;
    const screenShareProducer = screenShareProducerRef.current;
    const directConnections = directSourcesRef.current.flatMap((source) =>
      source.getConnections()
    );
    if (
      [
        producerTransport,
        consumerTransport,
        screenShareProducer,
        ...directConnections.map((peer) => peer.connection)
      ].some((target) => target && pendingStatsRequests.has(target))
    )
      return;
    const isCurrent = () => generationRef.current === generation;
    if (
      !producerTransportRef.current &&
      !consumerTransportRef.current &&
      !directSourcesRef.current.length
    ) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      logVoice('stats: monitoring stopped', { reason: 'transports closed' });
      return;
    }

    collectingRef.current = generation;
    try {
      const client = getTRPCClient();
      if (
        !controlPendingRef.current ||
        controlPendingRef.current.client !== client
      ) {
        if (controlPendingRef.current) controlMeasurementRef.current = null;
        let request = pendingControlPings.get(client);
        if (!request) {
          const start = performance.now();
          request = client.others.ping
            .query()
            .then(() => performance.now() - start)
            .finally(() => pendingControlPings.delete(client));
          pendingControlPings.set(client, request);
        }
        const pending = { client, request };
        controlPendingRef.current = pending;
        request
          .then((rtt) => {
            if (isCurrent() && monitoringRef.current)
              controlMeasurementRef.current = { rtt, timestamp: Date.now() };
          })
          .catch(() => {
            if (isCurrent()) controlMeasurementRef.current = null;
          })
          .finally(() => {
            if (controlPendingRef.current === pending)
              controlPendingRef.current = null;
          });
      }
    } catch {
      controlMeasurementRef.current = null;
    }
    try {
      let producerStats: TransportStats | null = null;
      let consumerStats: TransportStats | null = null;

      if (producerTransport) {
        try {
          const producerStatsReport = await getStats(producerTransport);
          if (!isCurrent()) return;

          producerStats = parseTransportStats(producerStatsReport, true);
        } catch {
          if (!isCurrent()) return;
          producerTransportRef.current = null;
        }
      }

      if (consumerTransport) {
        try {
          const consumerStatsReport = await getStats(consumerTransport);
          if (!isCurrent()) return;

          consumerStats = parseTransportStats(consumerStatsReport, false);
        } catch {
          if (!isCurrent()) return;
          consumerTransportRef.current = null;
        }
      }

      const peerRtts: Record<number, number | null> = {};
      const directReports = new Map<RTCPeerConnection, RTCStatsReport>();
      const directSamples: [RTCPeerConnection, TransportStats][] = [];
      let directStats: TransportStats | null = null;
      let directSentDelta = 0;
      let directReceivedDelta = 0;
      let directBitrateSent = 0;
      let directBitrateReceived = 0;
      for (const peer of directConnections) {
        try {
          const report = await getStats(peer.connection);
          if (!isCurrent()) return;
          if (peer.connection.connectionState !== 'connected') continue;
          directReports.set(peer.connection, report);
          const sent = parseTransportStats(report, true);
          const received = parseTransportStats(report, false);
          const sample = {
            ...sent,
            bytesReceived: received.bytesReceived,
            packetsReceived: received.packetsReceived,
            packetsLost: received.packetsLost,
            jitter: received.jitter
          };
          const previous = previousDirectStatsRef.current.get(peer.connection);
          const sentDelta = Math.max(
            0,
            sample.bytesSent - (previous?.bytesSent ?? 0)
          );
          const receivedDelta = Math.max(
            0,
            sample.bytesReceived - (previous?.bytesReceived ?? 0)
          );
          directSentDelta += sentDelta;
          directReceivedDelta += receivedDelta;
          if (previous && sample.timestamp > previous.timestamp) {
            const seconds = (sample.timestamp - previous.timestamp) / 1000;
            directBitrateSent += sentDelta / seconds;
            directBitrateReceived += receivedDelta / seconds;
          }
          directSamples.push([peer.connection, sample]);
          if (!directStats) directStats = { ...sample };
          else {
            directStats.bytesSent += sample.bytesSent;
            directStats.bytesReceived += sample.bytesReceived;
            directStats.packetsSent += sample.packetsSent;
            directStats.packetsReceived += sample.packetsReceived;
            directStats.packetsLost += sample.packetsLost;
          }
          const rtt = selectedRtt(report);
          const previousRtt = peerRtts[peer.peerId];
          peerRtts[peer.peerId] =
            rtt === null
              ? (previousRtt ?? null)
              : Math.max(previousRtt ?? 0, rtt);
        } catch {
          if (!isCurrent()) return;
          peerRtts[peer.peerId] ??= null;
        }
      }

      let screenShareStatsResult: ScreenShareStats | null = null;
      const directScreen = directConnections.find(
        (peer) =>
          peer.kind === StreamKind.SCREEN && peer.direction === 'outgoing'
      );
      const screenTarget =
        screenShareProducer && !screenShareProducer.paused
          ? screenShareProducer
          : directScreen?.connection;
      const screenOpen =
        screenTarget &&
        ('closed' in screenTarget
          ? !screenTarget.closed
          : screenTarget.connectionState === 'connected');

      if (screenTarget && screenOpen) {
        try {
          const directReport =
            directScreen && screenTarget === directScreen.connection
              ? directReports.get(directScreen.connection)
              : undefined;
          const screenShareReport =
            directReport ?? (await getStats(screenTarget));
          if (!isCurrent()) return;

          const parsed = parseScreenShareStats(screenShareReport);

          if (parsed) {
            let screenShareBitrate = 0;
            const prev =
              previousScreenShareStatsRef.current?.target === screenTarget
                ? previousScreenShareStatsRef.current
                : null;

            if (prev && parsed.bytesSent > prev.bytesSent) {
              const timeDelta = (parsed.timestamp - prev.timestamp) / 1000;

              if (timeDelta > 0) {
                screenShareBitrate =
                  (parsed.bytesSent - prev.bytesSent) / timeDelta;
              }
            }

            const layerBytesSent = new Map<string, number>();
            const layers = parsed.layers.map((layer) => {
              let layerBitrate = 0;

              if (prev) {
                const previousBytesSent = prev.layerBytesSent.get(layer.id);
                const timeDelta = (parsed.timestamp - prev.timestamp) / 1000;

                if (
                  previousBytesSent !== undefined &&
                  layer.bytesSent > previousBytesSent &&
                  timeDelta > 0
                ) {
                  layerBitrate =
                    (layer.bytesSent - previousBytesSent) / timeDelta;
                }
              }

              layerBytesSent.set(layer.id, layer.bytesSent);

              return {
                ...layer,
                bitrate: layerBitrate
              };
            });

            previousScreenShareStatsRef.current = {
              target: screenTarget,
              bytesSent: parsed.bytesSent,
              layerBytesSent,
              timestamp: parsed.timestamp
            };

            screenShareStatsResult = {
              ...parsed,
              layers,
              bitrate: screenShareBitrate
            };
          }
        } catch {
          if (!isCurrent()) return;
          if (screenTarget === screenShareProducer)
            screenShareProducerRef.current = null;
          previousScreenShareStatsRef.current = null;
        }
      } else {
        previousScreenShareStatsRef.current = null;
      }

      if (
        !producerTransportRef.current &&
        !consumerTransportRef.current &&
        !directSourcesRef.current.length
      ) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }

        logVoice('stats: monitoring stopped', {
          reason: 'all transports closed'
        });
        return;
      }

      const previousProducer = previousStatsRef.current.producer;
      const previousConsumer = previousStatsRef.current.consumer;

      const bytesReceivedDelta =
        consumerStats && previousConsumer
          ? consumerStats.bytesReceived - previousConsumer.bytesReceived
          : 0;

      const bytesSentDelta =
        producerStats && previousProducer
          ? producerStats.bytesSent - previousProducer.bytesSent
          : 0;

      let currentBitrateSent = 0;
      let currentBitrateReceived = 0;

      if (producerStats && previousProducer && bytesSentDelta > 0) {
        const timeDeltaSent =
          (producerStats.timestamp - previousProducer.timestamp) / 1000;

        if (timeDeltaSent > 0) {
          currentBitrateSent = bytesSentDelta / timeDeltaSent;
        }
      }

      if (consumerStats && previousConsumer && bytesReceivedDelta > 0) {
        const timeDeltaReceived =
          (consumerStats.timestamp - previousConsumer.timestamp) / 1000;

        if (timeDeltaReceived > 0) {
          currentBitrateReceived = bytesReceivedDelta / timeDeltaReceived;
        }
      }

      for (const [connection, sample] of directSamples)
        previousDirectStatsRef.current.set(connection, sample);
      const control = controlMeasurementRef.current;
      setStats((prev) => ({
        serverRtt:
          control && Date.now() - control.timestamp <= intervalMsRef.current * 3
            ? control.rtt
            : null,
        peerRtts,
        direct: directStats,
        producer: producerStats,
        consumer: consumerStats,
        screenShare: screenShareStatsResult,
        totalBytesReceived:
          prev.totalBytesReceived +
          Math.max(0, bytesReceivedDelta) +
          directReceivedDelta,
        totalBytesSent:
          prev.totalBytesSent + Math.max(0, bytesSentDelta) + directSentDelta,
        currentBitrateSent: currentBitrateSent + directBitrateSent,
        currentBitrateReceived: currentBitrateReceived + directBitrateReceived
      }));

      previousStatsRef.current = {
        producer: producerStats,
        consumer: consumerStats
      };
    } catch (error) {
      logVoiceError('stats: collection failed', error);
    } finally {
      if (collectingRef.current === generation) collectingRef.current = null;
    }
  }, [parseTransportStats, parseScreenShareStats]);

  const applyPolling = useCallback(() => {
    const hasTransport =
      !!producerTransportRef.current ||
      !!consumerTransportRef.current ||
      directSourcesRef.current.length > 0;
    const shouldPoll =
      monitoringRef.current && hasTransport && subscriberCountRef.current > 0;

    if (shouldPoll === !!intervalRef.current) return;

    if (!shouldPoll) {
      generationRef.current += 1;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      return;
    }

    collectStats();
    intervalRef.current = setInterval(collectStats, intervalMsRef.current);
  }, [collectStats]);

  // polling only runs while something is displaying the numbers: getStats on
  // three transports every second is real battery on a laptop
  const subscribe = useCallback(() => {
    subscriberCountRef.current += 1;
    applyPolling();

    return () => {
      subscriberCountRef.current = Math.max(0, subscriberCountRef.current - 1);
      applyPolling();
    };
  }, [applyPolling]);

  const startMonitoring = useCallback(
    (
      producerTransport?: Transport | null,
      consumerTransport?: Transport | null,
      intervalMs: number = 1000
    ) => {
      monitoringRef.current = true;
      generationRef.current += 1;
      producerTransportRef.current = producerTransport || null;
      consumerTransportRef.current = consumerTransport || null;
      intervalMsRef.current = intervalMs;

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      applyPolling();
    },
    [applyPolling]
  );

  const setScreenShareProducer = useCallback(
    (producer: Producer<AppData> | null | undefined) => {
      generationRef.current += 1;
      screenShareProducerRef.current = producer || null;

      if (!producer) {
        previousScreenShareStatsRef.current = null;

        setStats((prev) => ({
          ...prev,
          screenShare: null
        }));
      }
    },
    []
  );

  const stopMonitoring = useCallback(() => {
    monitoringRef.current = false;
    generationRef.current += 1;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    producerTransportRef.current = null;
    consumerTransportRef.current = null;
    screenShareProducerRef.current = null;

    logVoice('stats: monitoring stopped', { reason: 'session teardown' });
  }, []);

  const resetStats = useCallback(() => {
    generationRef.current += 1;
    setStats({
      serverRtt: null,
      peerRtts: {},
      direct: null,
      producer: null,
      consumer: null,
      screenShare: null,
      totalBytesReceived: 0,
      totalBytesSent: 0,
      currentBitrateSent: 0,
      currentBitrateReceived: 0
    });

    previousStatsRef.current = {
      producer: null,
      consumer: null
    };

    previousScreenShareStatsRef.current = null;

    logVoice('stats: reset');
    previousDirectStatsRef.current = new WeakMap();
    controlMeasurementRef.current = null;
  }, []);

  const printStats = useCallback(() => {
    logVoice('stats: current', { stats });
  }, [stats]);

  useEffect(() => {
    window.dodecagonDebug = {
      ...window.dodecagonDebug,
      printVoiceStats: printStats
    };

    return () => {
      delete window.dodecagonDebug?.printVoiceStats;
    };
  }, [printStats]);

  useEffect(() => {
    return () => {
      monitoringRef.current = false;
      generationRef.current += 1;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return {
    stats,
    startMonitoring,
    stopMonitoring,
    subscribe,
    resetStats,
    setScreenShareProducer
  };
};

export { useTransportStats };
