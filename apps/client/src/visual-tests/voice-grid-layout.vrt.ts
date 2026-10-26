import { CardTheme } from '@/components/channel-view/voice/card-theme';
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

const render = async (
  pinnedCardId?: string,
  participantsHidden = false,
  gridCards = cards,
  tileAspectRatio: number | undefined = 16 / 9
) => {
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
      tileAspectRatio,
      participantsHidden,
      onToggleParticipants: () => {},
      children: gridCards
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

test('the last partial row centers on the column pitch', async () => {
  const sevenCards = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) =>
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

  for (const tileAspectRatio of [16 / 9, undefined]) {
    await render(undefined, false, sevenCards, tileAspectRatio);
    await expect.poll(columns).toBe(3);
    const rects = Array.from(host!.querySelectorAll('[data-card]'), (tile) =>
      tile.getBoundingClientRect()
    );
    // the seventh card owns the middle column instead of the gutter before it,
    // in both the measured tile grid and the 1fr one
    expect(rects[6].left).toBeCloseTo(rects[1].left, 1);
    expect(rects[6].width).toBeCloseTo(rects[1].width, 1);
  }
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

test('profile background keeps its selected color in both grid and focused views', async () => {
  const profileCards = ['one', 'two'].map((id) =>
    createElement(
      'div',
      { key: id, className: 'relative size-full', 'data-profile-card': id },
      createElement(CardTheme, { profileColor: '#cec2cf' })
    )
  );
  await render();
  for (const pinnedCardId of [undefined, 'one']) {
    root!.render(
      createElement(VoiceGrid, {
        pinnedCardId,
        tileAspectRatio: 16 / 9,
        children: profileCards
      })
    );
    await expect
      .poll(() => {
        const backgrounds = host!.querySelectorAll('[data-profile-card] > div');
        return Array.from(backgrounds).map(
          (background) => getComputedStyle(background).backgroundColor
        );
      })
      .toEqual(['rgb(206, 194, 207)', 'rgb(206, 194, 207)']);
  }
});

test('focused participant leaves separate space for screen-share thumbnails', async () => {
  await render('one');
  const focused = host!.querySelector('[data-card="one"]')!;
  const share = host!.querySelector('[data-card="share"]')!;
  const main = focused.getBoundingClientRect();
  const thumbnail = share.getBoundingClientRect();
  expect(main.bottom).toBeLessThanOrEqual(thumbnail.top - 8);
  expect(main.width / main.height).toBeCloseTo(16 / 9);
});

test('the participant scroller leaves paint room around every speaking thumbnail', async () => {
  await render('share');
  const thumbnail = host!.querySelector<HTMLElement>('[data-card="one"]')!;
  const strip = thumbnail.parentElement!.parentElement!;
  const tileRect = thumbnail.getBoundingClientRect();
  const clipRect = strip.getBoundingClientRect();
  expect(tileRect.top - 2).toBeGreaterThanOrEqual(clipRect.top);
  expect(tileRect.bottom + 2).toBeLessThanOrEqual(clipRect.bottom);
  expect(tileRect.left - 2).toBeGreaterThanOrEqual(clipRect.left);
});
