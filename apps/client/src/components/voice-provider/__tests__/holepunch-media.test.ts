import { expect, test } from 'bun:test';
import { withHolepunchCandidate } from '../holepunch-media';

test('routes every active bundled media section through the native proxy without changing DTLS identity', () => {
  const fingerprint = 'a=fingerprint:sha-256 AA:BB:CC';
  const sdp = [
    'v=0',
    'o=- 1 1 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0 1',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'a=mid:0',
    fingerprint,
    'a=candidate:1 1 UDP 1 192.0.2.1 1234 typ host',
    'a=end-of-candidates',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=mid:1',
    fingerprint,
    'a=candidate:2 1 UDP 1 192.0.2.2 5678 typ srflx',
    'a=remote-candidates:1 192.0.2.3 4321',
    ''
  ].join('\r\n');
  const routed = withHolepunchCandidate(sdp, 45000);
  const sections = routed.split(/(?=^m=)/m).slice(1);
  for (const section of sections) {
    expect(section).toContain('127.0.0.1 45000 typ host\r\n');
    expect(section).toContain(fingerprint);
    expect(section.match(/^a=candidate:/gm)).toHaveLength(1);
    expect(section).not.toContain('192.0.2.');
  }
  expect(routed).toContain('a=group:BUNDLE 0 1\r\n');
});

test('does not reactivate rejected media sections', () => {
  const rejected = 'm=video 0 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\n';
  const sdp = `v=0\r\n${rejected}m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\n`;
  const routed = withHolepunchCandidate(sdp, 45000);
  expect(routed).toContain(rejected);
  const video = routed.split('m=audio')[0]!;
  expect(video).not.toContain('a=candidate:');
  expect(routed).toContain('127.0.0.1 45000 typ host');
});
