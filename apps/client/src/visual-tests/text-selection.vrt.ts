import { TestId } from '@dodecagon/shared';
import type { CDPSession } from '@vitest/browser-playwright';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';

let root: Root;

beforeAll(async () => {
  localStorage.clear();
  document.body.replaceChildren();

  for (const id of ['root', 'portal', 'imagePortal']) {
    const element = document.createElement('div');
    element.id = id;
    document.body.append(element);
  }

  const { ClientApp } = await import('../main');
  root = createRoot(document.getElementById('root')!);
  root.render(createElement(ClientApp));
  await page.getByTestId(TestId.CONNECT_IDENTITY_INPUT).fill('rnd332');
  await page.getByTestId(TestId.CONNECT_PASSWORD_INPUT).fill('password123');
  await page.getByTestId(TestId.CONNECT_BUTTON).click();
  await page
    .getByTestId(TestId.CHANNEL_ITEM)
    .filter({ hasText: 'general' })
    .click();
});

afterAll(() => root.unmount());

const selectByDrag = async (element: Element) => {
  window.getSelection()?.removeAllRanges();
  const bounds = element.getBoundingClientRect();
  const session: CDPSession = cdp();
  const y = bounds.top + bounds.height / 2;

  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: bounds.left + 1,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'mouse'
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: bounds.right - 1,
    y,
    button: 'left',
    buttons: 1,
    pointerType: 'mouse'
  });

  const selected = window.getSelection()?.toString() ?? '';

  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: bounds.right - 1,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'mouse'
  });

  return selected;
};

test('the own username in the sidebar control cannot be selected', async () => {
  const sidebar = page.getByTestId(TestId.LEFT_SIDEBAR);
  const ownName = sidebar.getByText('rnd332', { exact: true }).first();

  await expect.element(ownName).toBeVisible();

  expect(await selectByDrag(ownName.element())).toBe('');

  await userEvent.keyboard('{Escape}');
});

test('a member name in the members sidebar can be selected', async () => {
  // only one right dock is open at a time, so the members panel is asked for
  // explicitly instead of relying on whatever the previous test left open
  const { setMembersPanelOpen } = await import('@/features/app/actions');
  setMembersPanelOpen(true);
  const member = page.getByTestId(TestId.MEMBER_ITEM).first();

  await expect.element(member).toBeVisible();

  const memberName = member.getByText('rnd332', { exact: true });

  await expect.element(memberName).toBeVisible();

  expect(await selectByDrag(memberName.element())).toContain('rnd332');
});

test('a user message can be selected', async () => {
  const message = page
    .getByTestId(TestId.MESSAGE_ITEM)
    .getByText(/^Welcome back/);

  await expect.element(message).toBeVisible();

  expect(await selectByDrag(message.element())).toContain('Welcome back');
});

test('text in the message box can be selected and replaced', async () => {
  const editor = page.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR);
  const draft = 'Select this draft in the message box.';

  await editor.fill(draft);
  await userEvent.keyboard('{Control>}a{/Control}');

  expect(window.getSelection()?.toString()).toBe(draft);

  await userEvent.keyboard('Replacement draft');
  await expect.element(editor).toHaveTextContent('Replacement draft');

  await editor.fill('');
});
