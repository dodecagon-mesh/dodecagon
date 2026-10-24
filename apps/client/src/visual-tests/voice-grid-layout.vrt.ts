import { VoiceGrid } from '@/components/channel-view/voice/voice-grid';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import '../index.css';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}));

let root: Root | undefined;
let host: HTMLDivElement | undefined;
const cards = ['share', 'one', 'two', 'three'].map((id) =>
  createElement(
    'div',
    {
      key: id,
      'data-card': id,
      style: {
        width: '100%',
        height: '100%',
        minHeight: 90,
        background: 'gray'
      }
    },
    id
  )
);

const render = async (pinnedCardId?: string, participantsHidden = false) => {
  if (!host) {
    host = document.createElement('div');
    host.style.cssText =
      'position:fixed;left:0;top:0;width:1292px;height:720px';
    document.body.append(host);
    root = createRoot(host);
  }
  root!.render(
    createElement(VoiceGrid, {
      pinnedCardId,
      tileAspectRatio: 16 / 9,
      participantsHidden,
      onToggleParticipants: () => {},
      children: cards
    })
  );
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
};

const columns = () => {
  const grid = host!.firstElementChild!;
  return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
};

afterEach(() => {
  root?.unmount();
  root = undefined;
  host?.remove();
  host = undefined;
});

test('grid continues measuring after pinning, resizing and unpinning', async () => {
  await render();
  await expect.poll(columns).toBe(2);
  await render('share');
  host!.style.width = '380px';
  await render();
  await expect.poll(columns).toBe(1);
  host!.style.width = '1292px';
  await expect.poll(columns).toBe(2);
});

test('pinned participants keep the discord tile size', async () => {
  await render('share');
  const thumbnail = host!.querySelector('[data-card="one"]')!.parentElement!;
  const rect = thumbnail.getBoundingClientRect();
  // the size of the Discord overlay container, measured in the browser
  expect(rect.width).toBe(187);
  expect(rect.height).toBe(104);
});

test('removing an initially pinned card restores measurement for the remaining users', async () => {
  await render('share');
  root!.render(
    createElement(VoiceGrid, {
      pinnedCardId: 'share',
      tileAspectRatio: 16 / 9,
      children: cards.slice(1)
    })
  );
  await expect.poll(columns).toBe(2);
  expect(host!.querySelectorAll('[data-card]')).toHaveLength(3);
});

test('unpinning a stream after mount restores a two-column participant grid', async () => {
  await render('share');
  await render();
  await expect.poll(columns).toBe(2);
  const tiles = Array.from(host!.querySelectorAll('[data-card]'));
  const rects = tiles.map((tile) => tile.getBoundingClientRect());
  expect(rects[0].top).toBe(rects[1].top);
  expect(rects[0].left).toBeLessThan(rects[1].left);
  expect(rects[0].width / rects[0].height).toBeCloseTo(16 / 9);
  expect(rects[0].width).toBe(rects[3].width);
  expect(rects[3].bottom).toBeLessThanOrEqual(
    host!.getBoundingClientRect().bottom
  );
});

test('hiding participants collapses the strip without removing focused media', async () => {
  await render('share');
  await render('share', true);

  const strip = host!.querySelector<HTMLElement>('[inert]')!;
  expect(strip).not.toBeNull();
  expect(strip.getBoundingClientRect().height).toBe(0);
  expect(host!.querySelector('[data-card="share"]')).not.toBeNull();

  await render('share', false);
  await expect
    .poll(() => strip.getBoundingClientRect().height)
    .toBeGreaterThan(0);
});
