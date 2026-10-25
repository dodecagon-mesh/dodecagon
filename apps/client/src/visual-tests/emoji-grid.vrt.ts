import { EmojiGrid } from '@/components/emoji-picker/emoji-grid';
import type { TEmojiItem } from '@/components/tiptap-input/helpers';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import '../index.css';

const emojis = (prefix: string, count: number): TEmojiItem[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `${prefix}_${index}`,
    shortcodes: [`${prefix}_${index}`],
    emoji: '😀'
  }));

test('a long emoji grid keeps its last row reachable and selects the actual emoji', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'height:240px;width:320px';
  document.body.append(host);
  const root = createRoot(host);
  const selected: string[] = [];
  root.render(
    createElement(EmojiGrid, {
      emojis: emojis('emoji', 400),
      onSelect: (emoji) => selected.push(emoji.name)
    })
  );
  try {
    await expect
      .poll(() => host.querySelector('[title=":emoji_0:"]'))
      .not.toBeNull();
    expect(host.querySelectorAll('button').length).toBeLessThan(200);
    const scroller = host.firstElementChild as HTMLElement;
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => host.querySelector('[title=":emoji_399:"]'))
      .not.toBeNull();
    const last = host.querySelector<HTMLButtonElement>(
      '[title=":emoji_399:"]'
    )!;
    last.click();
    expect(selected).toEqual(['emoji_399']);
  } finally {
    root.unmount();
    host.remove();
  }
});

test('search and category changes reset a scrolled grid without dropping short results', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'height:240px;width:320px';
  document.body.append(host);
  const root = createRoot(host);
  const onSelect = () => {};
  const render = (items: TEmojiItem[]) =>
    root.render(createElement(EmojiGrid, { emojis: items, onSelect }));
  render(emojis('original', 400));
  try {
    await expect
      .poll(() => host.querySelector('[title=":original_0:"]'))
      .not.toBeNull();
    const scroller = host.firstElementChild as HTMLElement;
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => host.querySelector('[title=":original_399:"]'))
      .not.toBeNull();
    render(emojis('filtered', 4));
    await expect.poll(() => host.querySelectorAll('button').length).toBe(4);
    expect(host.querySelector('[title=":filtered_0:"]')).not.toBeNull();
    expect(host.querySelector('[title=":filtered_3:"]')).not.toBeNull();
    render(emojis('another', 400));
    await expect
      .poll(() => host.querySelector('[title=":another_0:"]'))
      .not.toBeNull();
    expect(host.querySelector('[title=":another_399:"]')).toBeNull();
  } finally {
    root.unmount();
    host.remove();
  }
});
