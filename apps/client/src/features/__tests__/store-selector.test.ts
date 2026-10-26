import { describe, expect, test } from 'bun:test';

interface IMeasure {
  renders: number;
  identical: boolean;
  stableProbeRenders: number;
  recomputationsBefore: number;
  recomputationsAfter: number;
}

// the render needs the browser globals and the react dom client, so it runs in
// its own process, the way the other render tests do
const measure = (): IMeasure => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', './store-selector.render.tsx'],
    cwd: import.meta.dir,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  if (!result.success) {
    throw new Error(result.stderr.toString());
  }

  const output = result.stdout.toString();
  const marker = output.indexOf('__RESULT__');

  if (marker === -1) {
    throw new Error(`no result in the render output:\n${output}`);
  }

  const payload = output.slice(marker + '__RESULT__'.length).trim();
  const line = payload.split('\n')[0];

  return JSON.parse(line) as IMeasure;
};

describe('useStoreSelector', () => {
  test('should hand back the same value after an unrelated state change', () => {
    const { renders, identical } = measure();

    expect(renders).toBeGreaterThanOrEqual(2);
    expect(identical).toBe(true);
  });

  test('should not render a component whose value did not change', () => {
    expect(measure().stableProbeRenders).toBe(1);
  });

  // the selector is the only cache: a hit here means the value came from
  // reselect, not from a second cache in the hook
  test('should not run the selector body again for an unrelated state change', () => {
    const { recomputationsBefore, recomputationsAfter } = measure();

    expect(recomputationsBefore).toBeGreaterThan(0);
    expect(recomputationsAfter).toBe(recomputationsBefore);
  });
});
