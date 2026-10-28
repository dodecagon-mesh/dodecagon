import type { TArtifact } from '@dodecagon/shared';
import {
  validateReleaseMetadata,
  type TReleaseMetadata
} from 'bun-sfe-autoupdater';
import fs from 'fs/promises';
import path from 'path';

const buildScriptDir = import.meta.dir;
const serverCwd = path.resolve(buildScriptDir, '..');
const rootCwd = path.resolve(serverCwd, '..', '..');

const rootPckJson = path.join(rootCwd, 'package.json');
const serverPckJson = path.join(rootCwd, 'apps', 'server', 'package.json');
const clientPckJson = path.join(rootCwd, 'apps', 'client', 'package.json');

const sharedPckJson = path.join(rootCwd, 'packages', 'shared', 'package.json');
const e2ePckJson = path.join(rootCwd, 'packages', 'e2e', 'package.json');
const pluginSdkPckJson = path.join(
  rootCwd,
  'packages',
  'plugin-sdk',
  'package.json'
);
const uiPckJson = path.join(rootCwd, 'packages', 'ui', 'package.json');
const scriptsPckJson = path.join(
  rootCwd,
  'packages',
  'scripts',
  'package.json'
);

const unpack = async (tgzPath: string, outDir: string) => {
  const tarProc = Bun.spawn(['tar', '-xzf', tgzPath, '-C', outDir], {
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit'
  });
  await tarProc.exited;

  if (tarProc.exitCode !== 0) {
    throw new Error(`Failed to unpack ${tgzPath}`);
  }
};

const MEDIASOUP_WORKER: Partial<
  Record<Bun.Build.Target, { kind: 'elf' | 'pe' | 'macho'; machine?: number }>
> = {
  'bun-linux-x64': { kind: 'elf', machine: 0x3e },
  'bun-linux-arm64': { kind: 'elf', machine: 0xb7 },
  'bun-windows-x64': { kind: 'pe' },
  'bun-darwin-arm64': { kind: 'macho', machine: 0x0100000c }
};

const assertWorkerMatchesTarget = async (
  workerPath: string,
  target: Bun.Build.Target
) => {
  const expected = MEDIASOUP_WORKER[target];

  if (!expected) {
    throw new Error(`Unsupported target for mediasoup binary: ${target}`);
  }

  const handle = await fs.open(workerPath, 'r');

  try {
    const header = Buffer.alloc(32);
    await handle.read(header, 0, 32, 0);

    if (expected.kind === 'elf') {
      if (header.subarray(0, 4).toString('binary') !== '\x7fELF') {
        throw new Error(
          `Mediasoup worker for ${target} is not an ELF file: ${workerPath}`
        );
      }

      const machine = header.readUInt16LE(18);

      if (machine !== expected.machine) {
        throw new Error(
          `Mediasoup worker for ${target} has machine ${machine}, expected ${expected.machine}: ${workerPath}`
        );
      }
    } else if (expected.kind === 'pe') {
      if (header.subarray(0, 2).toString('binary') !== 'MZ') {
        throw new Error(
          `Mediasoup worker for ${target} is not a PE file: ${workerPath}`
        );
      }
    } else {
      const magic = header.readUInt32LE(0);

      if (magic !== 0xfeedfacf) {
        throw new Error(
          `Mediasoup worker for ${target} is not a 64 bit Mach-O file: ${workerPath}`
        );
      }

      const cpu = header.readUInt32LE(4);

      if (cpu !== expected.machine) {
        throw new Error(
          `Mediasoup worker for ${target} has cpu type ${cpu.toString(16)}, expected ${expected.machine?.toString(16)}: ${workerPath}`
        );
      }
    }
  } finally {
    await handle.close();
  }
};

const downloadMediasoupBinary = async (
  version: string,
  target: Bun.Build.Target
) => {
  let url = `https://github.com/versatica/mediasoup/releases/download/${version}/`;
  let fileName = '';

  switch (target) {
    case 'bun-linux-x64':
      url += `mediasoup-worker-${version}-linux-x64-kernel6.tgz`;
      fileName = 'mediasoup-worker';
      break;
    case 'bun-linux-arm64':
      url += `mediasoup-worker-${version}-linux-arm64-kernel6.tgz`;
      fileName = 'mediasoup-worker';
      break;
    case 'bun-windows-x64':
      url += `mediasoup-worker-${version}-win32-x64.tgz`;
      fileName = 'mediasoup-worker.exe';
      break;
    case 'bun-darwin-arm64':
      url += `mediasoup-worker-${version}-darwin-arm64.tgz`;
      fileName = 'mediasoup-worker';
      break;
    default:
      throw new Error(`Unsupported target for mediasoup binary: ${target}`);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to download mediasoup binary for target ${target}: ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const targetPath = path.join(
    serverCwd,
    'build',
    'temp',
    `mediasoup-worker-${target}.tgz`
  );
  // the four targets compile concurrently, so every target unpacks into its own
  // folder. a shared path let one target embed another target's worker
  const targetDir = path.join(serverCwd, 'build', 'temp', target);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(targetPath, buffer);

  await unpack(targetPath, targetDir);

  const workerPath = path.join(targetDir, fileName);

  await assertWorkerMatchesTarget(workerPath, target);

  return { name: fileName, path: workerPath };
};

const getCurrentVersion = async () => {
  // the release workflow computes the next version from the tags and passes it
  // to the build, so package.json is not rewritten for every release
  if (process.env.DODECAGON_BUILD_VERSION) {
    return process.env.DODECAGON_BUILD_VERSION;
  }

  const pkg = JSON.parse(await fs.readFile(rootPckJson, 'utf8'));

  return pkg.version;
};

const getMediasoupVersion = async () => {
  const serverPkg = JSON.parse(await fs.readFile(serverPckJson, 'utf8'));

  return serverPkg.dependencies['mediasoup'].replace('^', '');
};

const patchPackageJsons = async (newVersion: string) => {
  const packageJsonPaths = [
    rootPckJson,
    serverPckJson,
    clientPckJson,
    sharedPckJson,
    e2ePckJson,
    pluginSdkPckJson,
    scriptsPckJson,
    uiPckJson
  ];

  for (const pckPath of packageJsonPaths) {
    const pkg = JSON.parse(await fs.readFile(pckPath, 'utf8'));

    pkg.version = newVersion;

    await fs.writeFile(pckPath, JSON.stringify(pkg, null, 2), 'utf8');
  }
};

type TTarget = {
  out: string;
  target: Bun.Build.Target;
};

const compile = async ({ out, target }: TTarget) => {
  const version = await getCurrentVersion();
  const mediasoupVersion = await getMediasoupVersion();
  const mediasoupBinary = await downloadMediasoupBinary(
    mediasoupVersion,
    target
  );

  const entryPoints = [
    path.join(serverCwd, 'src', 'index.ts'),
    path.join(serverCwd, 'build', 'temp', 'drizzle.zip'),
    path.join(serverCwd, 'build', 'temp', 'interface.zip'),
    path.join(serverCwd, 'build', 'temp', 'server.zip'),
    mediasoupBinary.path
  ];

  await Bun.build({
    entrypoints: entryPoints,
    compile: {
      outfile: out,
      target
    },
    define: {
      'process.env.DODECAGON_ENV': '"production"',
      'process.env.DODECAGON_BUILD_VERSION': `"${version}"`,
      'process.env.DODECAGON_BUILD_DATE': `"${new Date().toISOString()}"`,
      'process.env.DODECAGON_MEDIASOUP_BIN_NAME': `"${mediasoupBinary.name}"`,
      'process.env.CURRENT_VERSION': `"${version}"`
    }
  });
};

const getFileChecksum = async (filePath: string) => {
  const fileBuffer = await fs.readFile(filePath);
  const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hashHex;
};

const getVersionInfo = async (
  targets: TTarget[],
  outPath: string
): Promise<TReleaseMetadata> => {
  const version = await getCurrentVersion();

  const artifacts: TArtifact[] = [];

  for (const target of targets) {
    const artifactPath = path.join(outPath, target.out);

    artifacts.push({
      name: path.basename(artifactPath),
      target: target.target.replace('bun-', ''),
      size: (await fs.stat(artifactPath)).size,
      checksum: await getFileChecksum(artifactPath)
    });
  }

  const versionInfo = validateReleaseMetadata({
    version,
    releaseDate: new Date().toISOString(),
    artifacts
  });

  return versionInfo;
};

const rmIfExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    await fs.rm(filePath);
  } catch {
    // ignore
  }
};

export {
  compile,
  downloadMediasoupBinary,
  getCurrentVersion,
  getVersionInfo,
  patchPackageJsons,
  rmIfExists
};
export type { TTarget };
