import { describe, expect, test } from 'bun:test';

const renderCache = () => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', './cache.render.tsx'],
    cwd: import.meta.dir,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  if (!result.success) {
    throw new Error(result.stderr.toString());
  }

  const output = result.stdout.toString();
  const marker = output.indexOf('__MARKUP__');

  if (marker === -1) {
    throw new Error(`no markup in the render output:\n${output}`);
  }

  return output.slice(marker + '__MARKUP__'.length);
};

describe('Cache', () => {
  test('should show what the media cache holds and offer to clear it', () => {
    const html = renderCache();

    expect(html).toContain('Cached media');
    expect(html).toContain(
      'Images, avatars and banners are kept on this device'
    );
    expect(html).toContain('5 MB on disk');
    expect(html).toContain('Clear cache');
    expect(html).toContain('data-slot="button"');
  });

  test('should not show the unavailable note when the browser supports the cache', () => {
    const html = renderCache();

    expect(html).toContain('data-slot="button"');
    expect(html).not.toContain('does not let the site store media');
  });
});
