import { describe, expect, test } from 'bun:test';

const renderPluginInstallConfirm = () => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', './plugin-install-confirm.render.tsx'],
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

  return output.slice(marker + '__MARKUP__'.length).trim();
};

describe('PluginInstallConfirmDialog', () => {
  test('should keep the code execution warning visible', () => {
    const html = renderPluginInstallConfirm();

    expect(html).toContain('What plugins can do');
    expect(html).toContain('Plugins can read, modify, or delete');
    expect(html).toContain('all server data');
    expect(html).toContain('Plugins can execute');
    expect(html).toContain('arbitrary code');
    expect(html).toContain('user accounts, steal data, or damage your server');
    expect(html.match(/text-destructive/g)?.length).toBe(3);
  });
});
