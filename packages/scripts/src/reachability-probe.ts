#!/usr/bin/env bun
// Read-only reachability probe for a Dodecagon deployment: DNS, TLS, HTTPS,
// download timing, parallel handshakes, WebSocket upgrade, voice/TURN ports.
// Usage: bun ./src/reachability-probe.ts [baseUrl] [--voice-port N] [--turn-port N]

import { createSocket } from 'node:dgram';
import { resolve4 } from 'node:dns/promises';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

type TCheck = {
  ok: boolean | null;
  detail: string;
  [key: string]: unknown;
};

type TReport = {
  target: string;
  startedAt: string;
  checks: Record<string, TCheck>;
  source?: { ip: string | null; org: string | null };
  totalMs?: number;
  okCount?: number;
  failCount?: number;
  unknownCount?: number;
};

type TTlsHandshake = {
  protocol: string | null;
  authorized: boolean;
  san: string;
  issuer: string;
};

type TStunResult = 'answered' | 'invalid' | 'no-answer' | 'error';

const args = process.argv.slice(2);
const baseUrl = new URL(
  args.find((arg) => !arg.startsWith('--')) ?? 'https://discord.rnd332.com'
);
const opt = (name: string, fallback: number) => {
  const index = args.indexOf(name);
  const raw = index >= 0 ? args[index + 1] : undefined;
  return raw === undefined ? fallback : Number(raw);
};
const VOICE_PORT = opt('--voice-port', 25565);
const TURN_PORT = opt('--turn-port', 3478);
const host = baseUrl.host;

const t0 = performance.now();
const ms = (time: number) => Math.round(time * 10) / 10;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const report: TReport = {
  target: baseUrl.origin,
  startedAt: new Date().toISOString(),
  checks: {}
};
const rec = (name: string, value: TCheck) => {
  report.checks[name] = value;
  const label =
    value.ok === true ? 'PASS' : value.ok === false ? 'FAIL' : '????';
  console.log(`${label} ${name}: ${value.detail}`);
};

// Only a well-formed Binding Success Response with the matching transaction id
// counts as an answer; anything else means the reply came from something that
// is not a STUN server (or was not a reply at all).
const stunBinding = (port: number, timeoutMs = 4000): Promise<TStunResult> =>
  new Promise((resolve) => {
    const socket = createSocket('udp4');
    const transaction = Buffer.alloc(12);
    for (let i = 0; i < 12; i++) {
      transaction[i] = Math.floor(Math.random() * 256);
    }
    const message = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x00, 0x00, 0x21, 0x12, 0xa4, 0x42]),
      transaction
    ]);
    let settled = false;
    const done = (result: TStunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };
    const timer = setTimeout(() => done('no-answer'), timeoutMs);
    socket.on('message', (data) => {
      const valid =
        data.length >= 20 &&
        data.readUInt16BE(0) === 0x0101 &&
        data.readUInt32BE(4) === 0x2112a442 &&
        data.subarray(8, 20).equals(transaction);
      done(valid ? 'answered' : 'invalid');
    });
    socket.on('error', () => done('error'));
    socket.send(message, port, host);
  });

// The vantage is only meaningful with its egress recorded: a VPN exit here
// means the baseline is "via that exit", not "from the local ISP".
{
  const started = performance.now();
  let ip: string | null = null;
  let org: string | null = null;
  try {
    const response = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(4000)
    });
    const body = (await response.json()) as { ip?: string };
    ip = body.ip ?? null;
  } catch {
    // best-effort: an unreachable ipify still leaves ip=null
  }
  try {
    const response = await fetch('https://ipinfo.io/json', {
      signal: AbortSignal.timeout(4000)
    });
    const body = (await response.json()) as { ip?: string; org?: string };
    org = body.org ?? null;
    if (!ip) ip = body.ip ?? null;
  } catch {
    // optional enrichment: a failure must not hide the ipify result
  }
  report.source = { ip, org };
  rec('source-net', {
    ok: ip != null,
    detail: `egress ip=${ip} org=${org} ${ms(performance.now() - started)}ms`
  });
}

// DNS: system resolver vs DoH, to detect poisoned answers.
{
  const started = performance.now();
  let system: string[];
  try {
    system = await resolve4(host);
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error
        ? String(error.code)
        : errorMessage(error);
    system = [`error: ${code}`];
  }
  let doh: string[];
  try {
    const response = await fetch(
      `https://1.1.1.1/dns-query?name=${host}&type=A`,
      {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(5000)
      }
    );
    const body = (await response.json()) as {
      Answer?: { type: number; data: string }[];
    };
    doh = (body.Answer ?? [])
      .filter((answer) => answer.type === 1)
      .map((answer) => answer.data);
  } catch (error) {
    doh = [`error: ${errorMessage(error)}`];
  }
  const overlap = system.some((ip) => doh.includes(ip));
  rec('dns', {
    ok: overlap,
    detail: `system=[${system}] doh(1.1.1.1)=[${doh}] ${ms(performance.now() - started)}ms`,
    system,
    doh
  });
}

// TLS handshake + certificate.
{
  const started = performance.now();
  try {
    const info = await new Promise<TTlsHandshake>((resolve, reject) => {
      const socket = tlsConnect(
        443,
        host,
        { servername: host, timeout: 8000 },
        () => {
          const cert = socket.getPeerCertificate();
          const san = cert?.subjectaltname;
          const issuerOrg = cert?.issuer?.O;
          resolve({
            protocol: socket.getProtocol(),
            authorized: socket.authorized,
            san: Array.isArray(san) ? san.join(', ') : (san ?? ''),
            issuer: Array.isArray(issuerOrg)
              ? issuerOrg.join(', ')
              : (issuerOrg ?? '')
          });
          socket.end();
        }
      );
      socket.on('error', reject);
      socket.on('timeout', () => socket.destroy(new Error('timeout')));
    });
    rec('tls', {
      ok: true,
      detail: `${info.protocol} authorized=${info.authorized} san="${info.san}" issuer=${info.issuer} ${ms(performance.now() - started)}ms`,
      ...info
    });
  } catch (error) {
    rec('tls', {
      ok: false,
      detail: `${errorMessage(error)} ${ms(performance.now() - started)}ms`
    });
  }
}

// /healthz + version header.
{
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl.origin}/healthz`, {
      signal: AbortSignal.timeout(10000)
    });
    const version =
      response.headers.get('x-dodecagon-version') ??
      response.headers.get('x-sharkord-version');
    rec('healthz', {
      ok: response.status === 200,
      detail: `HTTP ${response.status} version=${version} ${ms(performance.now() - started)}ms`,
      status: response.status,
      version
    });
  } catch (error) {
    rec('healthz', {
      ok: false,
      detail: `${errorMessage(error)} ${ms(performance.now() - started)}ms`
    });
  }
}

// Download timing: SPA index + first referenced asset. One asset fetch only, so
// this catches an already-frozen path; it does not prove sustained transfers
// survive the ~15-20KB behavioral freeze trigger.
{
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl.origin}/`, {
      signal: AbortSignal.timeout(15000)
    });
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)]
      .map((match) => match[1])
      .filter((path): path is string => path !== undefined);
    let bytes = 0;
    let assetMs = 0;
    let assetUrl: string | null = null;
    const [firstAsset] = assets;
    if (firstAsset) {
      const assetStarted = performance.now();
      const assetResponse = await fetch(`${baseUrl.origin}${firstAsset}`, {
        signal: AbortSignal.timeout(20000)
      });
      const buffer = await assetResponse.arrayBuffer();
      bytes = buffer.byteLength;
      assetMs = ms(performance.now() - assetStarted);
      assetUrl = firstAsset;
    }
    rec('download', {
      ok: bytes > 20000,
      detail: `index ${html.length}B, asset ${bytes}B in ${assetMs}ms (${Math.round(bytes / 1024 / (assetMs / 1000 || 1))}KB/s) total ${ms(performance.now() - started)}ms`,
      indexBytes: html.length,
      asset: { bytes, ms: assetMs, url: assetUrl }
    });
  } catch (error) {
    rec('download', {
      ok: false,
      detail: `${errorMessage(error)} ${ms(performance.now() - started)}ms`
    });
  }
}

// Five parallel TLS handshakes to the same SNI. They close immediately, so this
// only catches a burnt SNI; the reported TSPU behavioral trigger involves
// parallel handshakes WITH transfers.
{
  const started = performance.now();
  try {
    const one = () =>
      new Promise<{ ok: boolean; ms: number; error?: string }>((resolve) => {
        const handshakeStarted = performance.now();
        const socket = tlsConnect(
          443,
          host,
          { servername: host, timeout: 10000 },
          () => {
            resolve({
              ok: true,
              ms: ms(performance.now() - handshakeStarted)
            });
            socket.end();
          }
        );
        socket.on('error', (error) =>
          resolve({
            ok: false,
            ms: ms(performance.now() - handshakeStarted),
            error: error.message
          })
        );
        socket.on('timeout', () => socket.destroy(new Error('timeout')));
      });
    const results = await Promise.all([one(), one(), one(), one(), one()]);
    const okCount = results.filter((result) => result.ok).length;
    rec('parallel-tls', {
      ok: okCount === 5,
      detail: `${okCount}/5 ok in ${ms(performance.now() - started)}ms [${results.map((result) => (result.ok ? result.ms : result.error)).join(', ')}]`,
      results
    });
  } catch (error) {
    rec('parallel-tls', {
      ok: false,
      detail: `${errorMessage(error)} ${ms(performance.now() - started)}ms`
    });
  }
}

// WebSocket upgrade (tRPC socket).
{
  const started = performance.now();
  try {
    const wsProtocol = baseUrl.protocol === 'https:' ? 'wss' : 'ws';
    const result = await new Promise<{ ok: boolean; error?: string }>(
      (resolve) => {
        const ws = new WebSocket(`${wsProtocol}://${host}`);
        const timer = setTimeout(() => {
          ws.close();
          resolve({ ok: false, error: 'timeout 8s' });
        }, 8000);
        ws.onopen = () => {
          clearTimeout(timer);
          ws.close();
          resolve({ ok: true });
        };
        ws.onerror = (event) => {
          clearTimeout(timer);
          resolve({
            ok: false,
            error: (event as ErrorEvent).message ?? 'ws error'
          });
        };
      }
    );
    rec('websocket', {
      ok: result.ok,
      detail: `${result.ok ? 'upgrade ok' : result.error} ${ms(performance.now() - started)}ms`
    });
  } catch (error) {
    rec('websocket', {
      ok: false,
      detail: `${errorMessage(error)} ${ms(performance.now() - started)}ms`
    });
  }
}

const tcpConnect = (port: number) =>
  new Promise<void>((resolve, reject) => {
    const socket = netConnect(port, host, () => {
      socket.end();
      resolve();
    });
    socket.setTimeout(6000, () => socket.destroy(new Error('timeout')));
    socket.on('error', reject);
  });

// Voice SFU port: TCP connect + UDP STUN binding.
{
  const tcpStarted = performance.now();
  try {
    await tcpConnect(VOICE_PORT);
    rec('voice-tcp', {
      ok: true,
      detail: `tcp/${VOICE_PORT} connect ${ms(performance.now() - tcpStarted)}ms`
    });
  } catch (error) {
    rec('voice-tcp', {
      ok: false,
      detail: `tcp/${VOICE_PORT} ${errorMessage(error)} ${ms(performance.now() - tcpStarted)}ms`
    });
  }
  const udpStarted = performance.now();
  const stun = await stunBinding(VOICE_PORT);
  // mediasoup may ignore unauthenticated binding requests, so silence is
  // unknown, not a failure; only a valid answer passes.
  rec('voice-udp', {
    ok: stun === 'answered' ? true : null,
    detail: `udp/${VOICE_PORT} STUN binding ${stun} ${ms(performance.now() - udpStarted)}ms (silence is INCONCLUSIVE: filtering or ICE-auth; not counted as failure)`
  });
}

// TURN: TCP connect + UDP STUN binding. coturn answers unauthenticated binding
// requests, so silence IS a failure here.
{
  const tcpStarted = performance.now();
  try {
    await tcpConnect(TURN_PORT);
    rec('turn-tcp', {
      ok: true,
      detail: `tcp/${TURN_PORT} connect ${ms(performance.now() - tcpStarted)}ms`
    });
  } catch (error) {
    rec('turn-tcp', {
      ok: false,
      detail: `tcp/${TURN_PORT} ${errorMessage(error)} ${ms(performance.now() - tcpStarted)}ms`
    });
  }
  const udpStarted = performance.now();
  const stun = await stunBinding(TURN_PORT);
  rec('turn-udp', {
    ok: stun === 'answered',
    detail: `udp/${TURN_PORT} STUN binding ${stun} ${ms(performance.now() - udpStarted)}ms`
  });
}

report.totalMs = ms(performance.now() - t0);
report.okCount = Object.values(report.checks).filter(
  (check) => check.ok === true
).length;
report.failCount = Object.values(report.checks).filter(
  (check) => check.ok === false
).length;
report.unknownCount = Object.values(report.checks).filter(
  (check) => check.ok === null
).length;
console.log(
  `---\n${report.okCount} pass, ${report.failCount} fail, ${report.unknownCount} unknown, total ${report.totalMs}ms`
);
console.log(`\n${JSON.stringify(report, null, 2)}`);
