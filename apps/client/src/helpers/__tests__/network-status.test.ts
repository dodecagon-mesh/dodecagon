import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { getNetworkStatus } from '../network-status';

const ORIGINAL_RTC = globalThis.RTCPeerConnection;

const sdpWith = (ports: number[]) =>
  [
    'v=0',
    't=0 0',
    ...ports.map(
      (port) =>
        `a=candidate:x${port} 1 udp 1686052607 203.0.113.9 ${port} typ srflx raddr 192.168.0.102 rport 54321 generation 0`
    )
  ].join('\r\n');

let nextSdp = '';
let lastConfiguration: { iceServers?: { urls?: string }[] } | undefined;

// the browser gathers on its own, so the check reads what a gather would have
// produced; this stands in for that without a network
class FakePeerConnection {
  iceGatheringState = 'new';
  localDescription: { sdp: string } | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(configuration: { iceServers?: { urls?: string }[] }) {
    lastConfiguration = configuration;
  }

  createDataChannel(): void {}

  async createOffer(): Promise<{ type: 'offer'; sdp: string }> {
    return { type: 'offer', sdp: '' };
  }

  async setLocalDescription(): Promise<void> {
    this.localDescription = { sdp: nextSdp };

    queueMicrotask(() => {
      this.iceGatheringState = 'complete';
      for (const listener of this.listeners) listener();
    });
  }

  addEventListener(_event: string, listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_event: string, listener: () => void): void {
    this.listeners.delete(listener);
  }

  close(): void {}
}

beforeEach(() => {
  lastConfiguration = undefined;
  Object.assign(globalThis, { RTCPeerConnection: FakePeerConnection });
});

afterEach(() => {
  Object.assign(globalThis, { RTCPeerConnection: ORIGINAL_RTC });
});

describe('getNetworkStatus', () => {
  it('asks the STUN servers the server published', async () => {
    nextSdp = sdpWith([46329, 46329]);

    await getNetworkStatus(
      ['stun:one.example.org:3478', 'stun:two.example.org:3478'],
      {
        force: true
      }
    );

    expect(lastConfiguration?.iceServers?.map(({ urls }) => urls)).toEqual([
      'stun:one.example.org:3478',
      'stun:two.example.org:3478'
    ]);
  });

  it('falls back to public servers when the deployment published fewer than two', async () => {
    nextSdp = sdpWith([46329, 46329]);

    const status = await getNetworkStatus(['stun:one.example.org:3478'], {
      force: true
    });

    expect(status.usedFallback).toBe(true);
    expect(status.servers).toHaveLength(2);
  });

  it('reports a stable mapping as open and keeps the mapped address in the log', async () => {
    nextSdp = sdpWith([46329, 46329]);
    const log = spyOn(console, 'log').mockImplementation(() => {});

    try {
      const status = await getNetworkStatus(
        ['stun:one.example.org:3478', 'stun:two.example.org:3478'],
        { force: true }
      );

      expect(status.reachability).toBe('open');
      expect(status.mapped).toEqual([
        { address: '203.0.113.9', port: 46329, basePort: 54321 },
        { address: '203.0.113.9', port: 46329, basePort: 54321 }
      ]);

      const line = log.mock.calls[0]?.at(-1);

      expect(typeof line).toBe('string');
      expect(line).toContain('"reachability":"open"');
      expect(line).toContain('203.0.113.9:46329');
    } finally {
      log.mockRestore();
    }
  });

  it('reports a drifting mapping as symmetric on a warning line', async () => {
    nextSdp = sdpWith([46329, 51117]);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const status = await getNetworkStatus(
        ['stun:one.example.org:3478', 'stun:two.example.org:3478'],
        { force: true }
      );

      expect(status.reachability).toBe('symmetric');

      const line = warn.mock.calls[0]?.at(-1);

      expect(typeof line).toBe('string');
      expect(line).toContain('"reachability":"symmetric"');
      expect(line).not.toContain('[object Object]');
    } finally {
      warn.mockRestore();
    }
  });

  it('reports no answer as blocked', async () => {
    nextSdp = sdpWith([]);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const status = await getNetworkStatus(
        ['stun:one.example.org:3478', 'stun:two.example.org:3478'],
        { force: true }
      );

      expect(status.reachability).toBe('blocked');
      expect(status.answeredServers).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });
});
