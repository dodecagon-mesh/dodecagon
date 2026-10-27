import { spawn, type ChildProcess } from 'node:child_process';
import * as dgram from 'node:dgram';
import * as net from 'node:net';
import * as path from 'node:path';
import * as readline from 'node:readline';

// runs the e2e suite as N playwright shards at once. each shard gets its own database
// directory, server/vite/webrtc ports, output directory and vite dep cache, so the shards
// never see each other's state; a failing shard stops its siblings instead of letting the
// run wait for timeouts that cannot pass
const PACKAGE_ROOT = path.resolve(import.meta.dir, '..');
const DRY_RUN = process.argv.includes('--dry-run');

const readInt = (name: string, fallback: number, minimum = 1): number => {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(
      `${name} must be an integer >= ${minimum}, received "${raw}"`
    );
  }

  return value;
};

const PARALLEL = readInt('DOD_E2E_PARALLEL', 4);
const BASE_HTTP_PORT = readInt('DOD_E2E_BASE_HTTP_PORT', 6100);
const BASE_WEBRTC_PORT = readInt('DOD_E2E_BASE_WEBRTC_PORT', 15200);
const RETRIES = readInt('DOD_E2E_RETRIES', 0, 0);

// the layout reserves a 100 port block per slot: http base + 10.. and webrtc base + 10..
// for the shards, while the dev server keeps + 0 and + 1. nine shards are the most that fit
// before the next slot
if (PARALLEL > 9) {
  throw new Error(
    `DOD_E2E_PARALLEL must be at most 9 to fit the 100 port slot, received ${PARALLEL}`
  );
}

const DATA_ROOT = path.resolve(
  process.env.DOD_E2E_DATA_ROOT ?? path.join(PACKAGE_ROOT, 'e2e-data')
);

type TShardPlan = {
  shard: string;
  serverPort: number;
  clientPort: number;
  webRtcPort: number;
  dataPath: string;
  outputDir: string;
  viteCacheDir: string;
};

const plans: TShardPlan[] = Array.from({ length: PARALLEL }, (_, index) => {
  const shardNumber = index + 1;

  return {
    shard: `${shardNumber}/${PARALLEL}`,
    // shard i takes server + 10 + i * 10, vite + 11 + i * 10 and media + 10 + i * 10:
    // the dev server keeps + 0 and + 1, so dev and the gate can run in one slot
    serverPort: BASE_HTTP_PORT + 10 + index * 10,
    clientPort: BASE_HTTP_PORT + 11 + index * 10,
    webRtcPort: BASE_WEBRTC_PORT + 10 + index * 10,
    dataPath: path.join(DATA_ROOT, `shard-${shardNumber}`),
    outputDir: path.join(PACKAGE_ROOT, 'test-results', `shard-${shardNumber}`),
    viteCacheDir: path.join(PACKAGE_ROOT, '.cache', `vite-shard-${shardNumber}`)
  };
});

// preflight: a foreign dev server on one of the shard ports makes playwright fail with a
// webServer timeout after a minute, which says nothing about the actual conflict
const tcpFree = (port: number): Promise<boolean> => {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const server = net.createServer();

  server.unref();
  server.once('error', () => resolve(false));
  server.listen({ port, host: '0.0.0.0', exclusive: true }, () => {
    server.close(() => resolve(true));
  });

  return promise;
};

const udpFree = (port: number): Promise<boolean> => {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const socket = dgram.createSocket('udp4');

  socket.unref();
  socket.once('error', () => {
    try {
      socket.close();
    } catch {
      // a bind that failed never opened the handle, so there is nothing to close
    }

    resolve(false);
  });
  socket.bind({ port, address: '0.0.0.0', exclusive: true }, () => {
    socket.close(() => resolve(true));
  });

  return promise;
};

const checks = plans.flatMap((plan) => [
  {
    label: `shard ${plan.shard} server`,
    protocol: 'tcp',
    port: plan.serverPort
  },
  { label: `shard ${plan.shard} vite`, protocol: 'tcp', port: plan.clientPort },
  // mediasoup listens on both protocols on the webrtc port
  {
    label: `shard ${plan.shard} webrtc`,
    protocol: 'tcp',
    port: plan.webRtcPort
  },
  {
    label: `shard ${plan.shard} webrtc`,
    protocol: 'udp',
    port: plan.webRtcPort
  }
]);

const conflicts = (
  await Promise.all(
    checks.map(async (check) => ({
      ...check,
      free:
        check.protocol === 'tcp'
          ? await tcpFree(check.port)
          : await udpFree(check.port)
    }))
  )
).filter((check) => !check.free);

if (conflicts.length > 0) {
  for (const conflict of conflicts) {
    console.error(
      `[preflight] ${conflict.label} ${conflict.protocol} port ${conflict.port} is already in use`
    );
  }

  console.error(
    '[preflight] pick another slot with DOD_E2E_BASE_HTTP_PORT / DOD_E2E_BASE_WEBRTC_PORT or stop the process holding the ports'
  );
  process.exit(1);
}

if (DRY_RUN) {
  for (const plan of plans) {
    console.log(
      `[plan] shard ${plan.shard} server=${plan.serverPort} vite=${plan.clientPort} webrtc=${plan.webRtcPort} data=${plan.dataPath} output=${plan.outputDir} vite-cache=${plan.viteCacheDir}`
    );
  }

  process.exit(0);
}

const groups = new Set<number>();
let failureCode: number | null = null;

const killGroups = (signal: NodeJS.Signals) => {
  for (const pid of groups) {
    try {
      // the shard runs in its own group, so this also stops its playwright webServer
      process.kill(-pid, signal);
    } catch {
      // the group is already gone
    }
  }
};

const killAfterGracePeriod = () => {
  setTimeout(() => killGroups('SIGKILL'), 5_000).unref();
};

const failFast = (code: number) => {
  if (failureCode !== null) {
    return;
  }

  failureCode = code === 0 ? 1 : code;
  console.error(
    `[runner] a shard exited with ${failureCode}, stopping the other shards`
  );
  killGroups('SIGTERM');
  killAfterGracePeriod();
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    failureCode ??= 1;
    killGroups(signal);
    killAfterGracePeriod();
  });
}

const spawnWithPrefix = (
  command: string,
  args: string[],
  prefix: string,
  env: NodeJS.ProcessEnv
): ChildProcess => {
  const child = spawn(command, args, {
    cwd: PACKAGE_ROOT,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (child.pid) {
    groups.add(child.pid);
  }

  for (const [stream, output] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr]
  ] as const) {
    // playwright's list output uses carriage returns, but line buffering keeps the
    // interleaved shards readable and is what the prefixed logs are for
    if (stream) {
      readline
        .createInterface({ input: stream })
        .on('line', (line) => output.write(`${prefix} ${line}\n`));
    }
  }

  return child;
};

const exitOf = (child: ChildProcess): Promise<number> => {
  const { promise, resolve } = Promise.withResolvers<number>();

  child.once('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));

  return promise;
};

// the database has to exist before playwright starts the server on it, and the server
// seeds production rows on boot when the settings row is missing, so one seed per shard
let seedFailed = false;

for (const plan of plans) {
  const child = spawnWithPrefix(
    'bun',
    ['run', './tests/setup/seed-db.ts'],
    `[seed ${plan.shard}]`,
    {
      ...process.env,
      DOD_E2E_DATA_PATH: plan.dataPath,
      DODECAGON_DATA_PATH: plan.dataPath
    }
  );
  const code = await exitOf(child);

  if (code !== 0) {
    console.error(`[seed ${plan.shard}] seeding failed with exit code ${code}`);
    // exitCode instead of exit(), so the prefixed logs above are not cut off
    process.exitCode = code;
    seedFailed = true;
    break;
  }
}

if (!seedFailed) {
  const shardCodes = await Promise.all(
    plans.map((plan) => {
      const child = spawnWithPrefix(
        'bunx',
        ['playwright', 'test', `--shard=${plan.shard}`],
        `[shard ${plan.shard}]`,
        {
          ...process.env,
          CI: '1',
          DOD_E2E_DATA_PATH: plan.dataPath,
          DOD_E2E_SERVER_PORT: String(plan.serverPort),
          DOD_E2E_CLIENT_PORT: String(plan.clientPort),
          DOD_E2E_WEBRTC_PORT: String(plan.webRtcPort),
          DOD_E2E_OUTPUT_DIR: plan.outputDir,
          DOD_VITE_CACHE_DIR: plan.viteCacheDir,
          DOD_E2E_RETRIES: String(RETRIES),
          DOD_E2E_REPORTER: process.env.DOD_E2E_REPORTER ?? 'list'
        }
      );

      const code = exitOf(child);

      void code.then((exitCode) => {
        if (exitCode !== 0) {
          failFast(exitCode);
        }
      });

      return code;
    })
  );

  // playwright stops its webServer on normal exit, but a killed shard can leave the
  // server, vite and the mediasoup worker behind; the group kill makes the next run
  // start from a clean slot even after a failure
  killGroups('SIGTERM');

  process.exitCode = failureCode ?? shardCodes.find((code) => code !== 0) ?? 0;
}
