#!/usr/bin/env bun
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildSlotEnv,
  findSlotRecord,
  getWorktreeRoot,
  type TSlotRecord
} from './agent-slot';

// small tier: run only the tests that cover what changed. anything that cannot be
// narrowed safely falls back to a package suite instead of silently skipping tests.
type TPackageKey = 'client' | 'server' | 'shared';

type TPackagePlan = {
  full: boolean;
  files: Set<string>;
  reasons: string[];
  touched: Set<string>;
};

type TPlan = Record<TPackageKey, TPackagePlan> & {
  skipped: string[];
};

type TChangedFiles = {
  branch: string[];
  unstaged: string[];
  staged: string[];
  untracked: string[];
  files: string[];
};

type TTestIndex = {
  files: string[];
  contents: Map<string, string>;
};

const PACKAGE_KEYS: TPackageKey[] = ['client', 'server', 'shared'];

const PACKAGE_DIRS: Record<TPackageKey, string> = {
  client: 'apps/client',
  server: 'apps/server',
  shared: 'packages/shared'
};

const PACKAGE_LABELS: Record<TPackageKey, string> = {
  client: 'client',
  server: 'server',
  shared: 'shared'
};

const isTestFile = (file: string) =>
  /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file);

const toPosix = (file: string) => file.split(path.sep).join('/');
const toRelative = (packageDir: string, file: string) =>
  toPosix(path.relative(packageDir, file));

const run = async (cmd: string[], cwd: string) => {
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

const gitFiles = async (repoRoot: string, args: string[]) => {
  const result = await run(['git', ...args], repoRoot);

  if (result.code !== 0) return null;

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const collectChangedFiles = async (
  repoRoot: string
): Promise<TChangedFiles> => {
  const [branch, unstaged, staged, untracked] = await Promise.all([
    gitFiles(repoRoot, ['diff', '--name-only', 'origin/master...HEAD']),
    gitFiles(repoRoot, ['diff', '--name-only']),
    gitFiles(repoRoot, ['diff', '--cached', '--name-only']),
    gitFiles(repoRoot, ['ls-files', '--others', '--exclude-standard'])
  ]);

  if (!branch) {
    console.error(
      'test-changed: origin/master is not available, comparing the working tree only'
    );
  }

  const files = new Set([
    ...(branch ?? []),
    ...(unstaged ?? []),
    ...(staged ?? []),
    ...(untracked ?? [])
  ]);

  return {
    branch: branch ?? [],
    unstaged: unstaged ?? [],
    staged: staged ?? [],
    untracked: untracked ?? [],
    files: [...files].sort()
  };
};

const walkTestFiles = async (
  dir: string,
  files: string[] = []
): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkTestFiles(full, files);
      continue;
    }

    if (entry.isFile() && isTestFile(entry.name)) files.push(full);
  }

  return files;
};

const getTestIndex = async (
  cache: Map<TPackageKey, TTestIndex>,
  repoRoot: string,
  key: TPackageKey
) => {
  const cached = cache.get(key);

  if (cached) return cached;

  const packageDir = path.join(repoRoot, PACKAGE_DIRS[key]);
  const index: TTestIndex = {
    files: await walkTestFiles(packageDir),
    contents: new Map()
  };

  cache.set(key, index);

  return index;
};

const readTestContent = async (index: TTestIndex, file: string) => {
  const cached = index.contents.get(file);

  if (cached !== undefined) return cached;

  const content = await fs.readFile(file, 'utf8');

  index.contents.set(file, content);

  return content;
};

const findNearestTestsDir = async (
  start: string,
  packageDir: string
): Promise<string | null> => {
  let dir = start;

  while (dir.startsWith(packageDir)) {
    if (path.basename(dir) === '__tests__') return dir;

    const candidate = path.join(dir, '__tests__');
    let isDir = false;

    try {
      const stat = await fs.stat(candidate);

      isDir = stat.isDirectory();
    } catch {
      isDir = false;
    }

    if (isDir) return candidate;
    if (dir === packageDir) break;
    dir = path.dirname(dir);
  }

  return null;
};

const createPlan = (): TPlan => ({
  client: { full: false, files: new Set(), reasons: [], touched: new Set() },
  server: { full: false, files: new Set(), reasons: [], touched: new Set() },
  shared: { full: false, files: new Set(), reasons: [], touched: new Set() },
  skipped: []
});

const setFull = (plan: TPlan, key: TPackageKey, reason: string) => {
  const target = plan[key];

  target.full = true;
  target.files.clear();

  if (!target.reasons.includes(reason)) target.reasons.push(reason);
};

const setFullAll = (plan: TPlan, reason: string) => {
  for (const key of PACKAGE_KEYS) setFull(plan, key, reason);
};

const selectSource = async (
  plan: TPlan,
  indexes: Map<TPackageKey, TTestIndex>,
  repoRoot: string,
  key: TPackageKey,
  file: string
) => {
  const target = plan[key];

  const packageDir = path.join(repoRoot, PACKAGE_DIRS[key]);
  const fullFile = path.join(repoRoot, file);
  const relative = toRelative(packageDir, fullFile);

  if (isTestFile(file)) {
    let exists = true;

    try {
      await fs.access(fullFile);
    } catch {
      exists = false;
    }

    if (!exists) {
      plan.skipped.push(`${file}: deleted test`);
      return;
    }

    if (key === 'server' && relative.endsWith('start-server.test.ts')) {
      plan.skipped.push(
        `${file}: the server package excludes the bundle test, run signoff for it`
      );
      return;
    }

    target.files.add(relative);
    return;
  }

  target.touched.add(file);

  if (
    (key === 'server' && relative.startsWith('src/__tests__/')) ||
    (key === 'client' && relative.startsWith('src/test-utils/'))
  ) {
    setFull(plan, key, `test setup changed (${file})`);
    return;
  }

  const index = await getTestIndex(indexes, repoRoot, key);
  const nearest = await findNearestTestsDir(path.dirname(fullFile), packageDir);
  const selected = new Set<string>();

  if (nearest) {
    const prefix = `${nearest}${path.sep}`;

    for (const test of index.files) {
      if (test.startsWith(prefix)) selected.add(toRelative(packageDir, test));
    }
  }

  const extension = path.extname(file);
  const base = path.basename(file, extension);
  const searchName =
    base === 'index' ? path.basename(path.dirname(file)) : base;

  for (const test of index.files) {
    const testRelative = toRelative(packageDir, test);

    if (selected.has(testRelative)) continue;

    const content = await readTestContent(index, test);

    if (content.includes(searchName)) selected.add(testRelative);
  }

  if (selected.size === 0) {
    setFull(plan, key, `no test matched ${file}`);
    return;
  }

  for (const test of selected) target.files.add(test);
};

const buildPlan = async (plan: TPlan, repoRoot: string, changed: string[]) => {
  const indexes = new Map<TPackageKey, TTestIndex>();

  for (const file of changed) {
    if (file.startsWith('apps/client/src/')) {
      await selectSource(plan, indexes, repoRoot, 'client', file);
      continue;
    }

    if (file.startsWith('apps/server/src/')) {
      await selectSource(plan, indexes, repoRoot, 'server', file);
      continue;
    }

    if (file.startsWith('packages/shared/')) {
      setFullAll(plan, `shared package changed (${file})`);
      continue;
    }

    if (file.startsWith('packages/ui/')) {
      setFull(plan, 'client', `ui package changed (${file})`);
      continue;
    }

    if (file.startsWith('packages/plugin-sdk/')) {
      setFullAll(plan, `plugin sdk changed (${file})`);
      continue;
    }

    if (
      file.startsWith('packages/e2e/') ||
      file.startsWith('packages/scripts/')
    ) {
      plan.skipped.push(
        `${file}: no unit suite covers this package, signoff runs e2e and the tooling`
      );
      continue;
    }

    const rootConfig =
      file === 'package.json' ||
      file === 'bun.lock' ||
      file === 'bunfig.toml' ||
      file === 'tsconfig.json' ||
      file === '.prettierrc.json' ||
      file.startsWith('.github/') ||
      file.startsWith('.husky/') ||
      file.startsWith('scripts/');

    if (rootConfig) {
      setFullAll(plan, `root config changed (${file})`);
      continue;
    }

    if (file.startsWith('apps/client/')) {
      setFull(plan, 'client', `client config changed (${file})`);
      continue;
    }

    if (file.startsWith('apps/server/')) {
      setFull(plan, 'server', `server config changed (${file})`);
      continue;
    }

    setFullAll(plan, `unmapped change (${file})`);
  }

  for (const key of PACKAGE_KEYS) {
    const target = plan[key];

    if (!target.full && target.touched.size > 0 && target.files.size === 0) {
      setFull(plan, key, 'no matching tests, using the package suite');
    }
  }

  return plan;
};

const printPlan = (plan: TPlan, changed: TChangedFiles, full: boolean) => {
  console.log(`test-changed${full ? ' (full)' : ''}`);
  console.log(
    `changed: ${changed.files.length} files (${changed.branch.length} on branch, ${changed.unstaged.length + changed.staged.length} uncommitted, ${changed.untracked.length} untracked)`
  );

  for (const key of PACKAGE_KEYS) {
    const target = plan[key];

    if (target.full) {
      console.log(
        `${PACKAGE_LABELS[key]}: full suite${target.reasons.length > 0 ? ` (${target.reasons.join('; ')})` : ''}`
      );
      continue;
    }

    if (target.files.size === 0) continue;

    console.log(`${PACKAGE_LABELS[key]}: ${target.files.size} tests`);

    for (const file of [...target.files].sort()) console.log(`  ${file}`);
  }

  for (const reason of plan.skipped) console.log(`skipped: ${reason}`);
};

const needsRun = (plan: TPlan, key: TPackageKey) =>
  plan[key].full || plan[key].files.size > 0;

const runPlan = async (
  repoRoot: string,
  plan: TPlan,
  slot: TSlotRecord | null
) => {
  const serverEnv = slot ? buildSlotEnv(slot) : {};
  const results: { key: TPackageKey; code: number }[] = [];

  for (const key of PACKAGE_KEYS) {
    if (!needsRun(plan, key)) continue;

    const target = plan[key];
    const packageDir = path.join(repoRoot, PACKAGE_DIRS[key]);
    const files = [...target.files].sort();
    let cmd: string[];

    if (target.full) {
      cmd = [process.execPath, 'run', 'test'];
    } else if (key === 'server') {
      cmd = [
        process.execPath,
        'test',
        '--path-ignore-patterns=**/start-server.test.ts',
        ...files
      ];
    } else {
      cmd = [process.execPath, 'test', ...files];
    }

    const env =
      key === 'server' ? { ...process.env, ...serverEnv } : process.env;

    console.log(`\nrunning: ${cmd.join(' ')} (cwd ${PACKAGE_DIRS[key]})`);

    const child = Bun.spawn({
      cmd,
      cwd: packageDir,
      env,
      stdout: 'inherit',
      stderr: 'inherit'
    });
    const code = await child.exited;

    results.push({ key, code });

    console.log(
      code === 0
        ? `${PACKAGE_LABELS[key]}: passed`
        : `${PACKAGE_LABELS[key]}: failed (exit ${code})`
    );
  }

  return results;
};

const main = async () => {
  const full = process.argv.slice(2).includes('--full');
  const worktree = await getWorktreeRoot();
  const changed = await collectChangedFiles(worktree);
  const plan = createPlan();

  if (full) {
    for (const key of PACKAGE_KEYS) setFull(plan, key, '--full');
  } else {
    await buildPlan(plan, worktree, changed.files);
  }

  printPlan(plan, changed, full);

  const found = await findSlotRecord(worktree);
  const serverTests = needsRun(plan, 'server');

  if (serverTests && !found) {
    throw new Error(
      'server tests need a slot for DODECAGON_WEBRTC_PORT; run "bun run agent:claim <task>" first'
    );
  }

  const results = await runPlan(worktree, plan, found?.record ?? null);

  if (results.length === 0) {
    console.log('\nno tests selected');
    return;
  }

  const failed = results.filter((result) => result.code !== 0);

  console.log(
    `\nresult: ${failed.length === 0 ? 'passed' : `failed (${failed.length}/${results.length})`}`
  );

  if (failed.length > 0) process.exitCode = 1;
};

export {
  buildPlan,
  collectChangedFiles,
  createPlan,
  isTestFile,
  type TPackageKey,
  type TPlan
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      `test-changed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  });
}
