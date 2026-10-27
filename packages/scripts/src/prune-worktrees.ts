#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const CANONICAL_WORKTREE = path.join(HOME, 'sharkord');
const SLOTS_DIR = path.join(HOME, '.agents', 'dodecagon', 'slots');
const DEFAULT_KEEP_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TWorktree = {
  path: string;
  head: string;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
};

export type TWorktreeSignals = {
  protectedWorktree: boolean;
  defaultBranch: boolean;
  agentSlot: boolean;
  merged: boolean;
  dirty: boolean;
  inProgress: boolean;
  inUse: boolean;
  ageDays: number;
  keepDays: number;
};

export type TDecision = {
  action: 'remove' | 'prune' | 'skip';
  reason: string;
};

export type TOptions = {
  repo: string | null;
  base: string;
  keepDays: number;
  apply: boolean;
  json: boolean;
  verbose: boolean;
  deleteBranches: boolean;
  help: boolean;
};

const emptyOptions: TOptions = {
  repo: null,
  base: 'origin/master',
  keepDays: DEFAULT_KEEP_DAYS,
  apply: false,
  json: false,
  verbose: false,
  deleteBranches: false,
  help: false
};

export const parseWorktreeList = (output: string): TWorktree[] => {
  const worktrees: TWorktree[] = [];
  let current: TWorktree | undefined;

  const flush = () => {
    if (current) {
      worktrees.push(current);
    }

    current = undefined;
  };

  for (const line of output.split('\n')) {
    if (line.length === 0) {
      flush();
      continue;
    }

    const separator = line.indexOf(' ');
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1);

    if (key === 'worktree') {
      flush();
      current = {
        path: value,
        head: '',
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        prunable: false
      };
      continue;
    }

    if (!current) {
      continue;
    }

    switch (key) {
      case 'HEAD':
        current.head = value;
        break;
      case 'branch':
        current.branch = value.replace(/^refs\/heads\//, '');
        break;
      case 'detached':
        current.detached = true;
        break;
      case 'bare':
        current.bare = true;
        break;
      case 'locked':
        current.locked = true;
        break;
      case 'prunable':
        current.prunable = true;
        break;
    }
  }

  flush();

  return worktrees;
};

export const classifyWorktree = (
  worktree: TWorktree,
  signals: TWorktreeSignals
): TDecision => {
  if (signals.protectedWorktree) {
    return { action: 'skip', reason: 'protected' };
  }

  if (worktree.bare) {
    return { action: 'skip', reason: 'bare' };
  }

  if (worktree.locked) {
    return { action: 'skip', reason: 'locked' };
  }

  if (worktree.prunable) {
    return { action: 'prune', reason: 'missing-directory' };
  }

  if (signals.defaultBranch) {
    return { action: 'skip', reason: 'default-branch' };
  }

  if (worktree.detached) {
    return { action: 'skip', reason: 'detached' };
  }

  if (signals.agentSlot) {
    return { action: 'skip', reason: 'agent-slot' };
  }

  if (!signals.merged) {
    return { action: 'skip', reason: 'unmerged' };
  }

  if (signals.dirty) {
    return { action: 'skip', reason: 'dirty' };
  }

  if (signals.inProgress) {
    return { action: 'skip', reason: 'in-progress' };
  }

  if (signals.inUse) {
    return { action: 'skip', reason: 'in-use' };
  }

  if (signals.ageDays < signals.keepDays) {
    return { action: 'skip', reason: 'recent' };
  }

  return { action: 'remove', reason: 'stale' };
};

export const humanBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  const rounded =
    exponent === 0 || value >= 10
      ? Math.round(value)
      : Number(value.toFixed(1));

  return `${rounded} ${units[exponent]}`;
};

export const parseArgs = (argv: string[]): TOptions => {
  const options: TOptions = { ...emptyOptions };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? '';

    const takeValue = (): string => {
      const value = argv[++index];

      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }

      return value;
    };

    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--dry-run':
        options.apply = false;
        break;
      case '--json':
        options.json = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--delete-branches':
        options.deleteBranches = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--repo':
        options.repo = takeValue();
        break;
      case '--base':
        options.base = takeValue();
        break;
      case '--keep-days': {
        const value = Number(takeValue());

        if (!Number.isFinite(value) || value < 0) {
          throw new Error('--keep-days must be a non-negative number');
        }

        options.keepDays = value;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

type TSlotRecord = {
  worktree?: string;
  pids?: number[];
};

type TProcessUsage = {
  cwds: string[];
  cmdlines: string[];
};

type TRow = {
  worktree: TWorktree;
  decision: TDecision;
  sizeBytes: number | null;
  lastActivity: number;
  ageDays: number;
  defaultBranch: boolean;
};

const canonicalPath = async (value: string): Promise<string> => {
  try {
    return await fsp.realpath(value);
  } catch {
    return path.resolve(value);
  }
};

const git = (cwd: string, args: string[]) =>
  spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });

type TMergedPr = {
  headRefName: string;
  headRefOid: string;
  isCrossRepository?: boolean;
};

type TMergedPrHeads = {
  heads: Map<string, Set<string>>;
  count: number;
  error: string | null;
};

const loadMergedPrHeads = (repo: string): TMergedPrHeads => {
  const result = spawnSync(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'merged',
      '--limit',
      '1000',
      '--json',
      'headRefName,headRefOid,isCrossRepository'
    ],
    {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000
    }
  );

  if (result.status !== 0) {
    const error =
      result.error?.message ||
      result.stderr.trim() ||
      result.stdout.trim() ||
      'gh pr list failed';

    return { heads: new Map(), count: 0, error };
  }

  try {
    const pullRequests = JSON.parse(result.stdout) as TMergedPr[];
    const heads = new Map<string, Set<string>>();

    for (const pullRequest of pullRequests) {
      if (pullRequest.isCrossRepository) {
        continue;
      }

      const branchHeads =
        heads.get(pullRequest.headRefName) ?? new Set<string>();
      branchHeads.add(pullRequest.headRefOid.toLowerCase());
      heads.set(pullRequest.headRefName, branchHeads);
    }

    return { heads, count: pullRequests.length, error: null };
  } catch (error) {
    return {
      heads: new Map(),
      count: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

const isGitOperationInProgress = async (
  worktreePath: string
): Promise<boolean> => {
  const dotGit = path.join(worktreePath, '.git');
  let gitDir = dotGit;

  try {
    if (!(await fsp.stat(dotGit)).isDirectory()) {
      const pointer = await fsp.readFile(dotGit, 'utf8');
      const match = /^gitdir:\s*(.+)$/m.exec(pointer);

      if (!match?.[1]) {
        return false;
      }

      gitDir = path.resolve(worktreePath, match[1].trim());
    }
  } catch {
    return false;
  }

  const markers = [
    'index.lock',
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'rebase-merge',
    'rebase-apply'
  ];

  return markers.some((marker) => fs.existsSync(path.join(gitDir, marker)));
};

const printHelp = () => {
  console.log(`Usage: prune-worktrees [options]

Removes stale git worktrees whose local branch tip is the head commit of a
merged pull request, are clean, have no live process, are not claimed by an
agent slot, and are older than --keep-days. Dry-run is the default; nothing
is deleted without --apply.

Options:
  --repo <path>         Repository to inspect (default: cwd or ~/sharkord)
  --base <ref>          Default branch for protection (default: origin/master)
  --keep-days <n>       Minimum idle age in days (default: ${DEFAULT_KEEP_DAYS})
  --apply               Remove candidate worktrees
  --dry-run             Only report candidates (default)
  --delete-branches     With --apply, also delete merged branches (git -d)
  --json                Print the full report as JSON
  --verbose, -v         List skipped worktrees and their reasons
  --help, -h            Show this help
`);
};

const loadActiveSlotWorktrees = async (): Promise<Set<string>> => {
  const active = new Set<string>();
  let files: string[] = [];

  try {
    files = await fsp.readdir(SLOTS_DIR);
  } catch {
    return active;
  }

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }

    try {
      const record = JSON.parse(
        await fsp.readFile(path.join(SLOTS_DIR, file), 'utf8')
      ) as TSlotRecord;

      if (typeof record.worktree === 'string' && record.worktree.length > 0) {
        active.add(await canonicalPath(record.worktree));
      }
    } catch {
      // An unreadable record is not proof the worktree is free. Ignore it:
      // the other safety checks (dirty, merged, in-use) still apply.
    }
  }

  return active;
};

const loadProcessUsage = async (): Promise<TProcessUsage> => {
  const usage: TProcessUsage = { cwds: [], cmdlines: [] };
  let pids: string[] = [];

  try {
    pids = await fsp.readdir('/proc');
  } catch {
    return usage;
  }

  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) {
      continue;
    }

    try {
      usage.cwds.push(await fsp.readlink(`/proc/${pid}/cwd`));
    } catch {
      // Process vanished or belongs to another user.
    }

    try {
      const cmdline = await fsp.readFile(`/proc/${pid}/cmdline`, 'utf8');

      if (cmdline.length > 0) {
        usage.cmdlines.push(cmdline.split('\0').join(' '));
      }
    } catch {
      // Process vanished or belongs to another user.
    }
  }

  return usage;
};

const dirSize = (dir: string): number => {
  const result = spawnSync('du', ['-s', '-B1', '--', dir], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });

  if (result.status !== 0) {
    return 0;
  }

  const [size] = result.stdout.trim().split(/\s+/);

  return Number.parseInt(size ?? '', 10) || 0;
};

const renderTable = (headers: string[], rows: string[][]) => {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length))
  );

  const line = (columns: string[]) =>
    columns
      .map((column, index) => (column ?? '').padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd();

  console.log(line(headers));
  console.log(line(widths.map((width) => '-'.repeat(width))));

  for (const row of rows) {
    console.log(line(row));
  }
};

const resolveRepo = (given: string | null): string => {
  if (given) {
    return path.resolve(given);
  }

  if (process.env.SHARKORD_REPO) {
    return path.resolve(process.env.SHARKORD_REPO);
  }

  const fromCwd = git(process.cwd(), ['rev-parse', '--show-toplevel']);

  if (fromCwd.status === 0) {
    return fromCwd.stdout.trim();
  }

  if (fs.existsSync(CANONICAL_WORKTREE)) {
    return CANONICAL_WORKTREE;
  }

  throw new Error(
    'Not inside a git worktree. Pass --repo <path> or set SHARKORD_REPO.'
  );
};

const inside = (parent: string, child: string) =>
  child === parent || child.startsWith(`${parent}${path.sep}`);

const main = async () => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const repo = await canonicalPath(resolveRepo(options.repo));

  if (git(repo, ['rev-parse', '--is-inside-work-tree']).status !== 0) {
    throw new Error(`Not a git repository: ${repo}`);
  }

  const baseCommit = git(repo, ['rev-parse', '--verify', options.base]);

  if (baseCommit.status !== 0) {
    throw new Error(
      `Cannot resolve ${options.base}. Fetch the remote or pass --base <ref>.`
    );
  }

  const baseSha = baseCommit.stdout.trim();
  const baseDate = git(repo, [
    'log',
    '-1',
    '--format=%cI',
    baseSha
  ]).stdout.trim();
  const worktreeOutput = git(repo, ['worktree', 'list', '--porcelain']);

  if (worktreeOutput.status !== 0) {
    throw new Error(worktreeOutput.stderr.trim() || 'git worktree list failed');
  }

  const worktrees = parseWorktreeList(worktreeOutput.stdout).map((worktree) =>
    fs.existsSync(worktree.path) ? worktree : { ...worktree, prunable: true }
  );

  const commonDir = git(repo, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir'
  ]);
  const mainWorktree =
    commonDir.status === 0 && commonDir.stdout.trim().length > 0
      ? path.dirname(commonDir.stdout.trim())
      : (worktrees[0]?.path ?? repo);

  const protectedPaths = new Set<string>([
    await canonicalPath(repo),
    await canonicalPath(mainWorktree)
  ]);

  if (fs.existsSync(CANONICAL_WORKTREE)) {
    protectedPaths.add(await canonicalPath(CANONICAL_WORKTREE));
  }

  const cwd = await canonicalPath(process.cwd());

  for (const worktree of worktrees) {
    if (inside(worktree.path, cwd)) {
      protectedPaths.add(await canonicalPath(worktree.path));
    }
  }

  const originHead = git(repo, [
    'symbolic-ref',
    '--quiet',
    'refs/remotes/origin/HEAD'
  ]);
  const remoteHeadBranch =
    originHead.status === 0
      ? originHead.stdout.trim().replace(/^refs\/remotes\/origin\//, '')
      : 'master';
  const baseBranch = options.base.replace(/^origin\//, '');
  const defaultBranches = new Set([
    remoteHeadBranch,
    baseBranch,
    'master',
    'main'
  ]);

  const activeSlots = await loadActiveSlotWorktrees();
  const usage = await loadProcessUsage();
  const mergedPrs = loadMergedPrHeads(repo);

  if (mergedPrs.error) {
    console.error(
      `prune-worktrees: merged PR data unavailable: ${mergedPrs.error}`
    );
  }

  const rows: TRow[] = [];

  for (const worktree of worktrees) {
    const isProtected = protectedPaths.has(await canonicalPath(worktree.path));
    const isDefaultBranch =
      worktree.branch !== null && defaultBranches.has(worktree.branch);
    const isSlotActive = activeSlots.has(await canonicalPath(worktree.path));

    const commit = worktree.head
      ? git(repo, ['log', '-1', '--format=%ct', worktree.head])
      : null;
    const commitMs = Number.parseInt(commit?.stdout.trim() ?? '', 10) * 1000;

    let dirMs = 0;

    try {
      dirMs = (await fsp.stat(worktree.path)).mtimeMs;
    } catch {
      dirMs = 0;
    }

    const lastActivity = Math.max(
      Number.isFinite(commitMs) ? commitMs : 0,
      dirMs
    );
    const ageDays =
      lastActivity === 0
        ? Number.POSITIVE_INFINITY
        : (Date.now() - lastActivity) / DAY_MS;

    const merged =
      worktree.branch !== null &&
      worktree.head.length > 0 &&
      (mergedPrs.heads.get(worktree.branch)?.has(worktree.head.toLowerCase()) ??
        false);

    let dirty = false;

    if (!worktree.prunable) {
      const status = git(worktree.path, [
        'status',
        '--porcelain',
        '--untracked-files=normal'
      ]);
      dirty = status.status !== 0 || status.stdout.trim().length > 0;
    }

    const inProgress =
      !worktree.prunable && (await isGitOperationInProgress(worktree.path));

    const inUse =
      usage.cwds.some((processCwd) => inside(worktree.path, processCwd)) ||
      usage.cmdlines.some((cmdline) => cmdline.includes(worktree.path));

    const decision = classifyWorktree(worktree, {
      protectedWorktree: isProtected,
      defaultBranch: isDefaultBranch,
      agentSlot: isSlotActive,
      merged,
      dirty,
      inProgress,
      inUse,
      ageDays,
      keepDays: options.keepDays
    });

    rows.push({
      worktree,
      decision,
      sizeBytes: null,
      lastActivity,
      ageDays,
      defaultBranch: isDefaultBranch
    });
  }

  for (const row of rows) {
    if (
      row.decision.action === 'remove' ||
      (options.verbose && row.worktree.path.length > 0)
    ) {
      row.sizeBytes = dirSize(row.worktree.path);
    }
  }

  const candidates = rows.filter((row) => row.decision.action === 'remove');
  const pruneCandidates = rows.filter((row) => row.decision.action === 'prune');
  const skipped = rows.filter((row) => row.decision.action === 'skip');
  const reclaimable = candidates.reduce(
    (total, row) => total + (row.sizeBytes ?? 0),
    0
  );
  const skippedByReason = new Map<string, number>();

  for (const row of skipped) {
    skippedByReason.set(
      row.decision.reason,
      (skippedByReason.get(row.decision.reason) ?? 0) + 1
    );
  }

  candidates.sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          repo,
          base: options.base,
          baseCommit: baseSha,
          mode: options.apply ? 'apply' : 'dry-run',
          keepDays: options.keepDays,
          generatedAt: new Date().toISOString(),
          summary: {
            worktrees: rows.length,
            candidates: candidates.length,
            pruneCandidates: pruneCandidates.length,
            reclaimableBytes: reclaimable,
            mergedPullRequests: mergedPrs.count,
            mergedPullRequestsError: mergedPrs.error,
            skippedByReason: Object.fromEntries(skippedByReason)
          },
          worktrees: rows.map((row) => ({
            path: row.worktree.path,
            branch: row.worktree.branch,
            head: row.worktree.head,
            detached: row.worktree.detached,
            locked: row.worktree.locked,
            prunable: row.worktree.prunable,
            action: row.decision.action,
            reason: row.decision.reason,
            sizeBytes: row.sizeBytes,
            lastActivity: new Date(row.lastActivity).toISOString(),
            ageDays:
              row.ageDays === Number.POSITIVE_INFINITY
                ? null
                : Number(row.ageDays.toFixed(1))
          }))
        },
        null,
        2
      )
    );
  } else {
    console.log(`repo:       ${repo}`);
    console.log(
      `base:       ${options.base} (${baseSha.slice(0, 8)}, ${baseDate})`
    );
    console.log(`mode:       ${options.apply ? 'apply' : 'dry-run'}`);
    console.log(`keep-days:  ${options.keepDays}`);
    console.log(
      `merged PRs: ${mergedPrs.error ? 'unavailable' : mergedPrs.count}`
    );
    console.log('');

    console.log(
      `Candidates: ${candidates.length} (${humanBytes(reclaimable)} reclaimable)`
    );

    if (candidates.length > 0) {
      renderTable(
        ['ACTION', 'AGE', 'LAST ACTIVITY', 'SIZE', 'BRANCH', 'PATH'],
        candidates.map((row) => [
          row.decision.action,
          `${Math.floor(row.ageDays)}d`,
          new Date(row.lastActivity).toISOString().slice(0, 10),
          humanBytes(row.sizeBytes ?? 0),
          row.worktree.branch ?? '(detached)',
          row.worktree.path
        ])
      );
    } else {
      console.log('  none');
    }

    if (pruneCandidates.length > 0) {
      console.log('');
      console.log(`Stale worktree metadata: ${pruneCandidates.length}`);
      renderTable(
        ['ACTION', 'PATH'],
        pruneCandidates.map((row) => [row.decision.action, row.worktree.path])
      );
    }

    const reasonSummary = [...skippedByReason.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `${reason} ${count}`)
      .join(', ');

    console.log('');
    console.log(
      `Skipped: ${skipped.length}${reasonSummary ? ` (${reasonSummary})` : ''}`
    );

    if (options.verbose && skipped.length > 0) {
      renderTable(
        ['REASON', 'AGE', 'BRANCH', 'PATH'],
        skipped.map((row) => [
          row.decision.reason,
          row.ageDays === Number.POSITIVE_INFINITY
            ? '-'
            : `${Math.floor(row.ageDays)}d`,
          row.worktree.branch ?? '(detached)',
          row.worktree.path
        ])
      );
    }

    if (!options.apply) {
      console.log('');
      console.log('Dry run: nothing was removed. Pass --apply to remove.');
    }
  }

  if (!options.apply) {
    return;
  }

  const errors: string[] = [];

  for (const row of candidates) {
    const removal = git(repo, ['worktree', 'remove', row.worktree.path]);

    if (removal.status !== 0) {
      errors.push(
        `${row.worktree.path}: ${removal.stderr.trim() || 'git worktree remove failed'}`
      );
      continue;
    }

    console.log(
      `removed ${row.worktree.path} (${humanBytes(row.sizeBytes ?? 0)})`
    );

    if (
      options.deleteBranches &&
      row.worktree.branch !== null &&
      !row.defaultBranch
    ) {
      const deletion = git(repo, ['branch', '-d', row.worktree.branch]);

      if (deletion.status === 0) {
        console.log(`deleted branch ${row.worktree.branch}`);
      } else {
        errors.push(
          `branch ${row.worktree.branch}: ${deletion.stderr.trim() || 'git branch -d failed'}`
        );
      }
    }
  }

  if (pruneCandidates.length > 0) {
    const prune = git(repo, ['worktree', 'prune']);

    if (prune.status !== 0) {
      errors.push(prune.stderr.trim() || 'git worktree prune failed');
    } else {
      console.log(`pruned ${pruneCandidates.length} stale worktree record(s)`);
    }
  }

  if (errors.length > 0) {
    console.error('');
    console.error(`Completed with ${errors.length} error(s):`);

    for (const error of errors) {
      console.error(`  ${error}`);
    }

    process.exitCode = 1;
  }
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(
      `prune-worktrees: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  });
}
