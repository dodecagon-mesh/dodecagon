import { describe, expect, it } from 'bun:test';
import {
  describeNetwork,
  describeNetworkVerdict,
  parseMappedEndpoints
} from '../network-reachability';

const mapped = (
  address: string,
  port: number,
  basePort = 54321,
  type = 'srflx'
) =>
  `a=candidate:${type}${port} 1 udp 1686052607 ${address} ${port} typ ${type} raddr 192.168.0.102 rport ${basePort} generation 0`;

const sdp = (...lines: string[]) => ['v=0', 't=0 0', ...lines].join('\r\n');

describe('parseMappedEndpoints', () => {
  it('reads the server reflexive answers and their local socket', () => {
    const endpoints = parseMappedEndpoints(
      sdp(
        'a=candidate:1 1 udp 2122260223 192.168.0.102 54321 typ host generation 0',
        mapped('185.61.79.142', 46329),
        mapped('185.61.79.142', 46329, 54321, 'prflx')
      )
    );

    expect(endpoints).toEqual([
      { address: '185.61.79.142', port: 46329, basePort: 54321 },
      { address: '185.61.79.142', port: 46329, basePort: 54321 }
    ]);
  });

  it('ignores a line without a type or a port', () => {
    expect(
      parseMappedEndpoints(
        sdp('a=candidate:1 1 udp 2122260223', 'a=candidate:2 1 udp 1 h p')
      )
    ).toEqual([]);
  });
});

describe('describeNetwork', () => {
  it('calls one stable port from two servers an open network', () => {
    const result = describeNetwork({
      serverCount: 2,
      mapped: parseMappedEndpoints(
        sdp(
          mapped('185.61.79.142', 46329, 54321),
          mapped('185.61.79.142', 46329, 54321)
        )
      )
    });

    expect(result).toEqual({
      reachability: 'open',
      distinctPorts: 1,
      answeredServers: 2
    });
  });

  it('calls a different port per destination symmetric', () => {
    const result = describeNetwork({
      serverCount: 2,
      mapped: parseMappedEndpoints(
        sdp(
          mapped('185.61.79.142', 46329, 54321),
          mapped('185.61.79.142', 51117, 54321)
        )
      )
    });

    expect(result).toEqual({
      reachability: 'symmetric',
      distinctPorts: 2,
      answeredServers: 2
    });
  });

  it('keeps two local sockets apart instead of reading them as symmetric', () => {
    // two interfaces, each with its own stable port: the mapping does not
    // depend on the destination, so direct media can still work
    const result = describeNetwork({
      serverCount: 2,
      mapped: parseMappedEndpoints(
        sdp(
          mapped('185.61.79.142', 46329, 54321),
          mapped('185.61.79.142', 46329, 54321),
          mapped('185.61.79.142', 46330, 54322),
          mapped('185.61.79.142', 46330, 54322)
        )
      )
    });

    expect(result.reachability).toBe('open');
    expect(result.distinctPorts).toBe(2);
    expect(result.answeredServers).toBe(4);
  });

  it('calls no answer at all blocked', () => {
    expect(describeNetwork({ serverCount: 2, mapped: [] })).toEqual({
      reachability: 'blocked',
      distinctPorts: 0,
      answeredServers: 0
    });
  });

  it('does not classify a single answer', () => {
    const result = describeNetwork({
      serverCount: 2,
      mapped: parseMappedEndpoints(sdp(mapped('185.61.79.142', 46329)))
    });

    expect(result.reachability).toBe('unknown');
  });

  it('does not call an IPv6 only answer blocked', () => {
    const result = describeNetwork({
      serverCount: 2,
      mapped: parseMappedEndpoints(sdp(mapped('2a02:8108:1:2::7', 46329)))
    });

    expect(result.reachability).toBe('unknown');
  });
});

describe('describeNetworkVerdict', () => {
  it('maps every reachability to a tone and its own copy', () => {
    expect(describeNetworkVerdict('open')).toEqual({
      tone: 'success',
      titleKey: 'networkOpenTitle',
      descriptionKey: 'networkOpenDesc'
    });
    expect(describeNetworkVerdict('symmetric').tone).toBe('warning');
    expect(describeNetworkVerdict('blocked').tone).toBe('danger');
    expect(describeNetworkVerdict('unknown').tone).toBe('muted');
  });
});
