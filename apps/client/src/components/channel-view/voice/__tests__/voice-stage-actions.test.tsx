import { describe, expect, test } from 'bun:test';

const renderVoiceStageActions = (
  mode: 'expanded' | 'minified' | 'unpinned' | 'hidden'
) => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', './voice-stage-actions.render.tsx', mode],
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

describe('VoiceStageActions', () => {
  test('should place the viewers list right before the chat button', () => {
    const html = renderVoiceStageActions('expanded');

    const viewers = html.indexOf('aria-label="2 viewers"');
    const chatButton = html.indexOf('aria-label="Open Voice Chat"');

    expect(viewers).toBeGreaterThan(-1);
    expect(chatButton).toBeGreaterThan(viewers);
  });

  test('should show the viewers of the expanded demo', () => {
    const html = renderVoiceStageActions('expanded');

    expect(html).toContain('aria-label="2 viewers"');
    expect(html.match(/data-slot="avatar"/g)).toHaveLength(2);
  });

  test('should remove the viewers list when the demo is minified', () => {
    const html = renderVoiceStageActions('minified');

    expect(html).not.toContain('aria-label="2 viewers"');
    expect(html).toContain('aria-label="Open Voice Chat"');
  });

  test('should identify the current channel without a redundant participants action', () => {
    const html = renderVoiceStageActions('expanded');

    expect(html).toContain('General');
    expect(html).not.toContain('aria-label="Hide participants"');
    expect(html).not.toContain('aria-label="Show participants"');
  });

  test('should remove the viewers list when no demo is expanded', () => {
    const html = renderVoiceStageActions('unpinned');

    expect(html).not.toContain('aria-label="2 viewers"');
    expect(html).toContain('aria-label="Open Voice Chat"');
  });
});
