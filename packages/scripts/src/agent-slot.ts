#!/usr/bin/env bun
import dgram from 'node:dgram';
import { createWriteStream, type WriteStream } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// one slot owns a 100 port http block, a 100 port media block, one mcp port and a
// directory under ~/.agents/dodecagon/slots. the lock file is the claim, the json
// record is what the other commands read.
const SLOT_COUNT = 20;
const E2E_SHARDS = 9;
const CANONICAL_WORKTREE = path.join(os.homedir(), 'sharkord');
const STALE_UNREADABLE_LOCK_MS = 10_000;

type TProtocol = 'tcp' | 'udp';

type TPortCheck = {
  port: number;
  protocol: TProtocol;
  purpose: string;
};

type TE2ePorts = {
  shard: number;
  http: number;
  vite: number;
  webrtc: number;
};

type TSlotPorts = {
  http: number;
  vite: number;
  webrtc: number;
  mcp: number;
  e2e: TE2ePorts[];
};

type TSlotDataPaths = {
  slotDir: string;
  serverData: string;
  e2eData: string;
  mcpProfile: string;
  logs: string;
  viteCache: string;
};

type TSlotRecord = {
  slot: number;
  repo: string;
  worktree: string;
  branch: string;
  task: string;
  claimedAt: string;
  ports: TSlotPorts;
  dataPaths: TSlotDataPaths;
  pids: {
    server?: number;
    client?: number;
  };
};

type TSlotLock = {
  pid: number;
  worktree: string;
  task: string;
  claimedAt: string;
};

type THeavyLock = {
  pid: number;
  worktree: string;
  task: string;
  startedAt: string;
};

type TListener = {
  port: number;
  protocol: TProtocol;
  pid?: number;
  name?: string;
};

type TChild = {
  kill: (signal?: NodeJS.Signals) => void;
  exited: Promise<number>;
  exitCode: number | null;
};

const getSlotRoot = () =>
  process.env.DODECAGON_AGENT_SLOT_ROOT
    ? path.resolve(process.env.DODECAGON_AGENT_SLOT_ROOT)
    : path.join(os.homedir(), '.agents', 'dodecagon');

const getSlotsDir = () => path.join(getSlotRoot(), 'slots');

const getSlotDir = (slot: number) => {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) {
    throw new Error(`slot must be an integer between 0 and ${SLOT_COUNT - 1}`);
  }

  return path.join(getSlotsDir(), String(slot));
};

const getRecordPath = (slot: number) =>
  path.join(getSlotsDir(), `${slot}.json`);
const getLockPath = (slot: number) => path.join(getSlotsDir(), `${slot}.lock`);
const getHeavyLockPath = () => path.join(getSlotRoot(), 'heavy.lock');

const getHttpPort = (slot: number) => 6100 + slot * 100;
const getVitePort = (slot: number) => getHttpPort(slot) + 1;
const getWebrtcPort = (slot: number) => 15200 + slot * 100;
const getMcpPort = (slot: number) => 9000 + slot;
const getE2eHttpPort = (slot: number, shardIndex: number) =>
  getHttpPort(slot) + 10 + shardIndex * 10;
const getE2eVitePort = (slot: number, shardIndex: number) =>
  getVitePort(slot) + 10 + shardIndex * 10;
const getE2eWebrtcPort = (slot: number, shardIndex: number) =>
  getWebrtcPort(slot) + 10 + shardIndex * 10;

const getSlotPortChecks = (slot: number): TPortCheck[] => {
  const checks: TPortCheck[] = [
    { port: getHttpPort(slot), protocol: 'tcp', purpose: 'http' },
    { port: getVitePort(slot), protocol: 'tcp', purpose: 'vite' },
    { port: getWebrtcPort(slot), protocol: 'tcp', purpose: 'webrtc' },
    { port: getWebrtcPort(slot), protocol: 'udp', purpose: 'webrtc' },
    { port: getMcpPort(slot), protocol: 'tcp', purpose: 'mcp' }
  ];

  for (let index = 0; index < E2E_SHARDS; index++) {
    const shard = index + 1;
    const prefix = `e2e-shard-${shard}`;

    checks.push(
      {
        port: getE2eHttpPort(slot, index),
        protocol: 'tcp',
        purpose: `${prefix}-http`
      },
      {
        port: getE2eVitePort(slot, index),
        protocol: 'tcp',
        purpose: `${prefix}-vite`
      },
      {
        port: getE2eWebrtcPort(slot, index),
        protocol: 'tcp',
        purpose: `${prefix}-webrtc`
      },
      {
        port: getE2eWebrtcPort(slot, index),
        protocol: 'udp',
        purpose: `${prefix}-webrtc`
      }
    );
  }

  return checks;
};

const buildSlotPorts = (slot: number): TSlotPorts => ({
  http: getHttpPort(slot),
  vite: getVitePort(slot),
  webrtc: getWebrtcPort(slot),
  mcp: getMcpPort(slot),
  e2e: Array.from({ length: E2E_SHARDS }, (_, index) => ({
    shard: index + 1,
    http: getE2eHttpPort(slot, index),
    vite: getE2eVitePort(slot, index),
    webrtc: getE2eWebrtcPort(slot, index)
  }))
});

const buildSlotDataPaths = (slot: number): TSlotDataPaths => {
  const slotDir = getSlotDir(slot);

  return {
    slotDir,
    serverData: path.join(slotDir, 'server-data'),
    e2eData: path.join(slotDir, 'e2e-data'),
    mcpProfile: path.join(slotDir, 'mcp-profile'),
    logs: path.join(slotDir, 'logs'),
    viteCache: path.join(slotDir, 'vite-cache')
  };
};

const buildSlotEnv = (record: TSlotRecord): Record<string, string> => ({
  DODECAGON_PORT: String(record.ports.http),
  DODECAGON_WEBRTC_PORT: String(record.ports.webrtc),
  DODECAGON_DATA_PATH: record.dataPaths.serverData,
  SERVER_PORT: String(record.ports.http),
  VITE_PORT: String(record.ports.vite),
  DOD_E2E_BASE_HTTP_PORT: String(record.ports.http),
  DOD_E2E_BASE_WEBRTC_PORT: String(record.ports.webrtc),
  DOD_E2E_DATA_ROOT: record.dataPaths.e2eData,
  DOD_VITE_CACHE_DIR: record.dataPaths.viteCache,
  DODECAGON_WEBRTC_ANNOUNCED_ADDRESS: '127.0.0.1',
  DODECAGON_AUTOUPDATE: 'false'
});

const printExports = (record: TSlotRecord) => {
  for (const [key, value] of Object.entries(buildSlotEnv(record))) {
    console.log(`export ${key}='${value.replace(/'/g, `'\\''`)}'`);
  }
};

const readJson = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
};

const writeJson = async (file: string, value: unknown) => {
  const temporary = `${file}.${process.pid}.tmp`;

  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
};

const readLock = async <T>(file: string) => {
  const stat = await fs.stat(file).catch(() => null);

  if (!stat) return null;

  return {
    data: await readJson<T>(file),
    ageMs: Date.now() - stat.mtimeMs
  };
};

const isErrno = (error: unknown, code: string) =>
  (error as NodeJS.ErrnoException).code === code;

const isProcessAlive = (pid: number | undefined) => {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const isBindErrorFree = (code: string | undefined) =>
  code === 'EAFNOSUPPORT' || code === 'EADDRNOTAVAIL';

const tryTcpBind = (port: number, host: string, ipv6Only = false) => {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const server = net.createServer();

  server.once('error', (error: NodeJS.ErrnoException) => {
    resolve(isBindErrorFree(error.code));
  });
  server.listen({ host, port, exclusive: true, ipv6Only }, () => {
    server.close(() => resolve(true));
  });

  return promise;
};

const tryUdpBind = (port: number, host: string, type: 'udp4' | 'udp6') => {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const socket = dgram.createSocket({ type, ipv6Only: type === 'udp6' });

  socket.once('error', (error: NodeJS.ErrnoException) => {
    socket.close();
    resolve(isBindErrorFree(error.code));
  });
  socket.bind({ address: host, port, exclusive: true }, () => {
    socket.close();
    resolve(true);
  });

  return promise;
};

const isTcpPortFree = async (port: number) => {
  if (!(await tryTcpBind(port, '0.0.0.0'))) return false;

  return tryTcpBind(port, '::', true);
};

const isUdpPortFree = async (port: number) => {
  if (!(await tryUdpBind(port, '0.0.0.0', 'udp4'))) return false;

  return tryUdpBind(port, '::', 'udp6');
};

const findUnavailablePorts = async (checks: TPortCheck[]) => {
  // the dev media port and the first e2e shard share a port, and two parallel bind
  // probes on the same port would report each other as busy
  const unique = new Map<string, TPortCheck>();

  for (const check of checks) {
    const key = `${check.protocol}:${check.port}`;

    if (!unique.has(key)) unique.set(key, check);
  }

  const results = await Promise.all(
    [...unique.values()].map(async (check) => ({
      check,
      free:
        check.protocol === 'tcp'
          ? await isTcpPortFree(check.port)
          : await isUdpPortFree(check.port)
    }))
  );

  return results
    .filter(({ free }) => !free)
    .map(({ check }) => `${check.purpose} ${check.port}/${check.protocol}`);
};

const runCommand = async (cmd: string[], cwd: string) => {
  const child = Bun.spawn({
    cmd,
    cwd,
    stdout: 'pipe',
    stderr: 'pipe'
  });
  const stdout = child.stdout ? await new Response(child.stdout).text() : '';
  const stderr = child.stderr ? await new Response(child.stderr).text() : '';

  return {
    code: await child.exited,
    stdout: stdout.trim(),
    stderr: stderr.trim()
  };
};

const git = async (args: string[], cwd: string) => {
  const result = await runCommand(['git', ...args], cwd);

  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }

  return result.stdout;
};

const getWorktreeRoot = async (cwd = process.cwd()) => {
  const result = await runCommand(['git', 'rev-parse', '--show-toplevel'], cwd);

  if (result.code !== 0) {
    throw new Error(`not inside a git worktree: ${cwd}`);
  }

  return result.stdout;
};

const getRepoRoot = async (worktree: string) => {
  const commonDir = await git(
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    worktree
  );

  return path.basename(commonDir) === '.git'
    ? path.dirname(commonDir)
    : commonDir;
};

const findSlotRecord = async (worktree: string) => {
  const target = path.resolve(worktree);

  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const record = await readJson<TSlotRecord>(getRecordPath(slot));

    if (record && path.resolve(record.worktree) === target) {
      return { slot, record: { ...record, slot } };
    }
  }

  return null;
};

const requireSlotRecord = async () => {
  const worktree = await getWorktreeRoot();
  const found = await findSlotRecord(worktree);

  if (!found) {
    throw new Error(
      `no slot claimed for ${worktree}; run "bun run agent:claim <task>" first`
    );
  }

  return found.record;
};

const buildRecord = (
  slot: number,
  repo: string,
  worktree: string,
  branch: string,
  task: string
): TSlotRecord => ({
  slot,
  repo,
  worktree,
  branch,
  task,
  claimedAt: new Date().toISOString(),
  ports: buildSlotPorts(slot),
  dataPaths: buildSlotDataPaths(slot),
  pids: {}
});

const ensureSlotDirs = async (record: TSlotRecord) => {
  const { dataPaths } = record;

  await Promise.all(
    [
      dataPaths.serverData,
      dataPaths.e2eData,
      dataPaths.mcpProfile,
      dataPaths.logs,
      dataPaths.viteCache
    ].map((dir) => fs.mkdir(dir, { recursive: true }))
  );
};

const claimSlot = async (task: string) => {
  const worktree = await getWorktreeRoot();
  const existing = await findSlotRecord(worktree);

  if (existing) {
    const lock = await readLock<TSlotLock>(getLockPath(existing.slot));

    if (lock) {
      throw new Error(
        `worktree already claimed slot ${existing.slot} for "${existing.record.task}"; run "bun run agent:release" first`
      );
    }

    console.error(
      `removing orphaned record for slot ${existing.slot} in this worktree`
    );
    await fs.unlink(getRecordPath(existing.slot)).catch(() => undefined);
  }

  await fs.mkdir(getSlotsDir(), { recursive: true });

  const [repo, branch] = await Promise.all([
    getRepoRoot(worktree),
    git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree)
  ]);
  const skipped: string[] = [];

  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const lockPath = getLockPath(slot);
    const recordPath = getRecordPath(slot);
    const lock = await readLock<TSlotLock>(lockPath);
    const record = await readJson<TSlotRecord>(recordPath);

    if (lock) {
      if (record) {
        skipped.push(`${slot}: claimed by ${record.worktree}`);
        continue;
      }

      if (
        (lock.data && isProcessAlive(lock.data.pid)) ||
        (!lock.data && lock.ageMs < STALE_UNREADABLE_LOCK_MS)
      ) {
        skipped.push(`${slot}: claim in progress`);
        continue;
      }

      await fs.unlink(lockPath).catch(() => undefined);
    }

    if (record) {
      skipped.push(`${slot}: record without a lock`);
      continue;
    }

    let handle: FileHandle | null = null;

    try {
      handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          worktree,
          task,
          claimedAt: new Date().toISOString()
        } satisfies TSlotLock)
      );
    } catch (error) {
      if (isErrno(error, 'EEXIST')) {
        skipped.push(`${slot}: claimed concurrently`);
        continue;
      }

      await fs.unlink(lockPath).catch(() => undefined);
      throw error;
    } finally {
      await handle?.close();
    }

    try {
      const unavailable = await findUnavailablePorts(getSlotPortChecks(slot));

      if (unavailable.length > 0) {
        await fs.unlink(lockPath).catch(() => undefined);
        skipped.push(`${slot}: ports busy (${unavailable.join(', ')})`);
        continue;
      }

      const record = buildRecord(slot, repo, worktree, branch, task);

      await ensureSlotDirs(record);
      await writeJson(recordPath, record);

      console.error(
        `claimed slot ${slot} for ${branch} (${task}); vite http://localhost:${record.ports.vite}`
      );
      printExports(record);
      return;
    } catch (error) {
      await fs.unlink(lockPath).catch(() => undefined);
      throw error;
    }
  }

  throw new Error(
    `no free agent slot (0-${SLOT_COUNT - 1})${skipped.length > 0 ? `\n${skipped.join('\n')}` : ''}`
  );
};

const envCommand = async (asJson: boolean) => {
  const record = await requireSlotRecord();

  if (asJson) {
    console.log(JSON.stringify(buildSlotEnv(record), null, 2));
    return;
  }

  printExports(record);
};

const pipeProcessOutput = async (
  stream: ReadableStream<Uint8Array> | undefined,
  sink: WriteStream,
  target: NodeJS.WriteStream
) => {
  if (!stream) {
    sink.end();
    return;
  }

  const reader = stream.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;
      if (!value) continue;
      sink.write(value);
      target.write(value);
    }
  } finally {
    const { promise, resolve } = Promise.withResolvers<void>();

    sink.end(resolve);
    await promise;
  }
};

const stopChild = async (child: TChild) => {
  if (child.exitCode !== null) return;

  child.kill('SIGTERM');

  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 5_000);

  try {
    await child.exited;
  } finally {
    clearTimeout(timer);
  }
};

const terminatePid = async (pid: number) => {
  if (!isProcessAlive(pid)) return;

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }

  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await Bun.sleep(100);
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return;
  }
};

const devCommand = async () => {
  const record = await requireSlotRecord();
  const env = { ...process.env, ...buildSlotEnv(record) };
  const serverLog = path.join(record.dataPaths.logs, 'server.log');
  const clientLog = path.join(record.dataPaths.logs, 'client.log');
  const serverSink = createWriteStream(serverLog);
  const clientSink = createWriteStream(clientLog);
  const server = Bun.spawn({
    cmd: [process.execPath, 'dev'],
    cwd: path.join(record.worktree, 'apps/server'),
    env,
    stdout: 'pipe',
    stderr: 'pipe'
  });
  const client = Bun.spawn({
    cmd: [
      process.execPath,
      'dev',
      '--port',
      String(record.ports.vite),
      '--strictPort'
    ],
    cwd: path.join(record.worktree, 'apps/client'),
    env,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  record.pids = { server: server.pid, client: client.pid };
  await writeJson(getRecordPath(record.slot), record);

  console.error(
    `slot ${record.slot}: server pid ${server.pid}, client pid ${client.pid}`
  );
  console.error(`vite http://localhost:${record.ports.vite}`);
  console.error(`logs ${record.dataPaths.logs}`);

  const pipes = Promise.all([
    pipeProcessOutput(server.stdout, serverSink, process.stdout),
    pipeProcessOutput(server.stderr, serverSink, process.stderr),
    pipeProcessOutput(client.stdout, clientSink, process.stdout),
    pipeProcessOutput(client.stderr, clientSink, process.stderr)
  ]);
  let shuttingDown = false;
  let firstExitCode: number | null = null;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.all([stopChild(server), stopChild(client)]);
    record.pids = {};
    await writeJson(getRecordPath(record.slot), record).catch(() => undefined);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      shutdown().finally(() => process.exit(0));
    });
  }

  const handleExit = async (name: string, code: number) => {
    if (shuttingDown || firstExitCode !== null) return;

    firstExitCode = code;
    console.error(
      `slot ${record.slot}: ${name} exited with code ${code}; stopping the other process`
    );
    await stopChild(name === 'server' ? client : server);
  };

  await Promise.all([
    server.exited.then((code) => handleExit('server', code)),
    client.exited.then((code) => handleExit('client', code))
  ]);
  await pipes;
  await shutdown();
  process.exitCode = firstExitCode ?? 0;
};

const runInherited = async (
  cmd: string[],
  cwd: string,
  env: Record<string, string | undefined>
) => {
  const child = Bun.spawn({
    cmd,
    cwd,
    env,
    stdout: 'inherit',
    stderr: 'inherit'
  });

  return child.exited;
};

const checkCommand = async () => {
  const record = await requireSlotRecord();
  const env = { ...process.env, ...buildSlotEnv(record) };
  const check: number = await runInherited(
    [process.execPath, 'run', 'check:fast'],
    record.worktree,
    env
  );
  const tests: number = await runInherited(
    [process.execPath, './packages/scripts/src/test-changed.ts'],
    record.worktree,
    env
  );

  if (check !== 0 || tests !== 0) {
    process.exitCode = 1;
  }
};

const acquireHeavyLock = async (record: TSlotRecord) => {
  const lockPath = getHeavyLockPath();

  await fs.mkdir(getSlotRoot(), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lockPath, 'wx');

      try {
        await handle.writeFile(
          JSON.stringify({
            pid: process.pid,
            worktree: record.worktree,
            task: record.task,
            startedAt: new Date().toISOString()
          } satisfies THeavyLock)
        );
      } finally {
        await handle.close();
      }

      return;
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error;

      const lock = await readLock<THeavyLock>(lockPath);

      if (lock?.data && isProcessAlive(lock.data.pid)) {
        throw new Error(
          `signoff already running (pid ${lock.data.pid}, worktree ${lock.data.worktree}, since ${lock.data.startedAt})`
        );
      }

      if (!lock?.data && lock && lock.ageMs < STALE_UNREADABLE_LOCK_MS) {
        throw new Error('signoff lock is unreadable; retry in a moment');
      }

      console.error('removing stale signoff lock');
      await fs.unlink(lockPath).catch(() => undefined);
    }
  }

  throw new Error('could not acquire the signoff lock');
};

const releaseHeavyLock = async () => {
  const lockPath = getHeavyLockPath();
  const lock = await readJson<THeavyLock>(lockPath);

  if (lock?.pid !== process.pid) return;

  await fs.unlink(lockPath).catch(() => undefined);
};

const signoffCommand = async () => {
  const record = await requireSlotRecord();

  await acquireHeavyLock(record);

  try {
    const code = await runInherited(
      [process.execPath, 'run', 'signoff'],
      record.worktree,
      { ...process.env, ...buildSlotEnv(record) }
    );

    if (code !== 0) process.exitCode = code;
  } finally {
    await releaseHeavyLock();
  }
};

const readListeners = async () => {
  const [tcp, udp] = await Promise.all([
    runCommand(['ss', '-H', '-ltnp'], process.cwd()),
    runCommand(['ss', '-H', '-lunp'], process.cwd())
  ]);

  if (tcp.code !== 0 || udp.code !== 0) return null;

  const parse = (output: string, protocol: TProtocol): TListener[] => {
    const listeners: TListener[] = [];

    for (const line of output.split('\n')) {
      const fields = line.trim().split(/\s+/);
      const local = fields[3];

      if (!local) continue;

      const port = Number(local.slice(local.lastIndexOf(':') + 1));

      if (!Number.isInteger(port) || port <= 0) continue;

      const pidMatch = line.match(/pid=(\d+)/);
      const nameMatch = line.match(/users:\(\("([^"]+)"/);
      const pid = pidMatch?.[1];
      const name = nameMatch?.[1];

      listeners.push({
        port,
        protocol,
        ...(pid ? { pid: Number(pid) } : {}),
        ...(name ? { name } : {})
      });
    }

    return listeners;
  };

  return {
    tcp: parse(tcp.stdout, 'tcp'),
    udp: parse(udp.stdout, 'udp')
  };
};

const describeListener = (listener: TListener) => {
  if (!listener.pid) {
    return `${listener.port}/${listener.protocol} pid unknown`;
  }

  const name = listener.name ? ` ${listener.name}` : '';

  return `${listener.port}/${listener.protocol} pid ${listener.pid}${name}`;
};

const getOriginMasterStatus = async (worktree: string) => {
  const exists = await runCommand(
    ['git', 'rev-parse', '--verify', '--quiet', 'origin/master'],
    worktree
  );

  if (exists.code !== 0) return null;

  const [count, log] = await Promise.all([
    git(
      ['rev-list', '--left-right', '--count', 'origin/master...HEAD'],
      worktree
    ),
    git(['log', '-1', '--format=%h %cI', 'origin/master'], worktree)
  ]);
  const [behind, ahead] = count.split(/\s+/).map(Number);
  const [hash, ...date] = log.split(' ');

  return {
    ahead: ahead ?? 0,
    behind: behind ?? 0,
    hash: hash ?? '',
    date: date.join(' ')
  };
};

const getCanonicalWorktree = async (worktree: string) => {
  const output = await git(['worktree', 'list', '--porcelain'], worktree);
  const first = output.split('\n').find((line) => line.startsWith('worktree '));

  return first ? first.slice('worktree '.length) : CANONICAL_WORKTREE;
};

const doctorCommand = async () => {
  const worktree = await getWorktreeRoot();
  const found = await findSlotRecord(worktree);
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);
  const canonical = await getCanonicalWorktree(worktree);
  const origin = await getOriginMasterStatus(worktree);
  const listeners = await readListeners();

  console.log(`worktree: ${worktree}`);
  console.log(`branch: ${branch}`);
  console.log(
    `canonical worktree: ${worktree === canonical ? 'yes' : `no (${canonical})`}`
  );
  console.log(`on master: ${branch === 'master' ? 'yes' : 'no'}`);
  console.log(
    origin
      ? `origin/master: ${origin.hash} ${origin.date}, ${origin.behind} behind, ${origin.ahead} ahead`
      : 'origin/master: not fetched'
  );

  if (!found) {
    console.log('slot: none');
    console.log('entries:');

    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const record = await readJson<TSlotRecord>(getRecordPath(slot));

      if (record) {
        console.log(
          `  ${slot}: ${record.task} (${record.worktree}, branch ${record.branch})`
        );
      }
    }

    return;
  }

  const { record } = found;
  const ownedPids = new Set(
    [record.pids.server, record.pids.client].filter(
      (pid): pid is number => typeof pid === 'number'
    )
  );

  console.log(`slot: ${record.slot}`);
  console.log(`task: ${record.task}`);
  console.log(`repo: ${record.repo}`);
  console.log(`claimed: ${record.claimedAt}`);
  console.log('data:');
  console.log(`  slot: ${record.dataPaths.slotDir}`);
  console.log(`  server: ${record.dataPaths.serverData}`);
  console.log(`  e2e: ${record.dataPaths.e2eData}`);
  console.log(`  mcp profile: ${record.dataPaths.mcpProfile}`);
  console.log(`  vite cache: ${record.dataPaths.viteCache}`);
  console.log(`  logs: ${record.dataPaths.logs}`);

  const find = (port: number, protocol: TProtocol) => {
    const protocolListeners = listeners?.[protocol] ?? [];

    return protocolListeners.filter((listener) => listener.port === port);
  };
  const describe = (port: number, protocol: TProtocol) => {
    if (!listeners) return 'unknown';

    const owners = find(port, protocol);

    return owners.length > 0 ? owners.map(describeListener).join(', ') : 'free';
  };

  console.log('ports:');
  console.log(
    `  http ${record.ports.http}: ${describe(record.ports.http, 'tcp')}`
  );
  console.log(
    `  vite ${record.ports.vite}: ${describe(record.ports.vite, 'tcp')}`
  );
  console.log(
    `  webrtc ${record.ports.webrtc}: tcp ${describe(record.ports.webrtc, 'tcp')}, udp ${describe(record.ports.webrtc, 'udp')}`
  );
  console.log(
    `  mcp ${record.ports.mcp}: ${describe(record.ports.mcp, 'tcp')}`
  );

  for (const shard of record.ports.e2e) {
    console.log(
      `  e2e shard ${shard.shard}: http ${shard.http} ${describe(shard.http, 'tcp')}, vite ${shard.vite} ${describe(shard.vite, 'tcp')}, webrtc ${shard.webrtc} tcp ${describe(shard.webrtc, 'tcp')} udp ${describe(shard.webrtc, 'udp')}`
    );
  }

  const describePid = (pid: number | undefined) => {
    if (!pid) return 'none';

    return `${pid} (${isProcessAlive(pid) ? 'running' : 'not running'})`;
  };

  console.log('owned pids:');
  console.log(`  server: ${describePid(record.pids.server)}`);
  console.log(`  client: ${describePid(record.pids.client)}`);

  const slotChecks = getSlotPortChecks(record.slot);
  const slotPorts = new Set(
    slotChecks.map((check) => `${check.port}/${check.protocol}`)
  );
  const foreign = [...(listeners?.tcp ?? []), ...(listeners?.udp ?? [])].filter(
    (listener) =>
      slotPorts.has(`${listener.port}/${listener.protocol}`) &&
      (!listener.pid || !ownedPids.has(listener.pid))
  );

  let foreignText = 'unknown (ss not available)';

  if (listeners) {
    foreignText =
      foreign.length > 0 ? foreign.map(describeListener).join(', ') : 'none';
  }

  console.log(`foreign listeners: ${foreignText}`);

  const heavy = await readLock<THeavyLock>(getHeavyLockPath());

  if (!heavy) {
    console.log('signoff lock: free');
  } else if (heavy.data && isProcessAlive(heavy.data.pid)) {
    console.log(
      `signoff lock: held by pid ${heavy.data.pid} (${heavy.data.worktree})`
    );
  } else {
    console.log(`signoff lock: stale (pid ${heavy.data?.pid ?? 'unknown'})`);
  }
};

const releaseCommand = async (keepData: boolean) => {
  const record = await requireSlotRecord();
  const heavy = await readLock<THeavyLock>(getHeavyLockPath());

  if (heavy?.data && isProcessAlive(heavy.data.pid)) {
    throw new Error(
      `signoff is running (pid ${heavy.data.pid}); wait for it to finish before releasing`
    );
  }

  const pids = [record.pids.server, record.pids.client].filter(
    (pid): pid is number => typeof pid === 'number'
  );

  await Promise.all(pids.map(terminatePid));

  await fs.unlink(getRecordPath(record.slot)).catch(() => undefined);

  if (keepData) {
    await fs.rm(record.dataPaths.logs, { recursive: true, force: true });
  } else {
    await fs.rm(record.dataPaths.slotDir, { recursive: true, force: true });
  }

  await fs.unlink(getLockPath(record.slot)).catch(() => undefined);

  const killed = pids.length > 0 ? `, stopped ${pids.join(', ')}` : '';
  const data = keepData ? ', kept data' : ', removed data';

  console.error(`released slot ${record.slot}${killed}${data}`);
};

const mcpCommand = async () => {
  const record = await requireSlotRecord();
  const config = {
    mcpServers: {
      [`playwright-slot-${record.slot}`]: {
        command: 'npx',
        args: [
          '@playwright/mcp@latest',
          '--isolated',
          '--headless',
          '--port',
          String(record.ports.mcp),
          '--user-data-dir',
          record.dataPaths.mcpProfile
        ]
      }
    }
  };

  console.log(JSON.stringify(config, null, 2));
};

const usage = `usage: agent-slot <command>

  claim <task>     claim the first free slot for the current worktree
  env [--json]     print the slot environment
  dev              run the server and client with the slot environment
  check            run check:fast and the changed tests
  signoff          run the full signoff under the heavy lock
  doctor           print slot, ports, listeners and git state
  release [--keep-data]
                   stop the recorded pids and free the slot
  mcp              print the playwright mcp config for the slot`;

const main = async () => {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'claim': {
      const task = args.join(' ').trim();

      if (!task) throw new Error('claim needs a task name');
      await claimSlot(task);
      break;
    }
    case 'env':
      await envCommand(args.includes('--json'));
      break;
    case 'dev':
      await devCommand();
      break;
    case 'check':
      await checkCommand();
      break;
    case 'signoff':
      await signoffCommand();
      break;
    case 'doctor':
      await doctorCommand();
      break;
    case 'release':
      await releaseCommand(args.includes('--keep-data'));
      break;
    case 'mcp':
      await mcpCommand();
      break;
    case undefined:
    case '--help':
    case '-h':
      console.log(usage);
      break;
    default:
      throw new Error(`unknown command: ${command}\n\n${usage}`);
  }
};

export {
  buildSlotDataPaths,
  buildSlotEnv,
  buildSlotPorts,
  findSlotRecord,
  getE2eHttpPort,
  getE2eVitePort,
  getE2eWebrtcPort,
  getHttpPort,
  getMcpPort,
  getSlotPortChecks,
  getVitePort,
  getWebrtcPort,
  getWorktreeRoot,
  isTcpPortFree,
  isUdpPortFree,
  readJson,
  SLOT_COUNT
};
export type { TE2ePorts, TPortCheck, TSlotDataPaths, TSlotPorts, TSlotRecord };

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      `agent-slot: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  });
}
