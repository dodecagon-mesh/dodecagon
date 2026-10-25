import { TestId } from '@dodecagon/shared';
import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './fixtures';
import { INFINITE_SCROLL_CHANNEL, openChannel } from './helpers/channels';
import {
  getLoadedMessageCount,
  getMockMessageNumbers,
  messageItems,
  NEWEST_MOCK_MESSAGE,
  waitForNewestMockMessage
} from './helpers/messages';
import {
  messagesContainer,
  waitForStableScroll,
  wheelUpUntil
} from './helpers/scroll';

const PAGE_SIZE = 100;
const MAX_RENDERED_MESSAGES = 150;

const jumpTo = async (page: Page, target: number) => {
  await page.keyboard.press('ControlOrMeta+K');
  const searchInput = page.getByTestId(TestId.SEARCH_INPUT);
  await expect(searchInput).toBeVisible();
  await searchInput.fill(`Mock message ${target}`);
  const jumpButton = page.getByTestId(TestId.SEARCH_RESULT_JUMP).first();
  await expect(jumpButton).toBeVisible();
  await jumpButton.click();
  await expect
    .poll(async () => (await getMockMessageNumbers(page)).includes(target))
    .toBe(true);
};

test('scrolling up loads older messages and keeps visible rows ordered', async ({
  page
}) => {
  await loginAs(page, 'testowner', 'password123');
  await openChannel(page, INFINITE_SCROLL_CHANNEL);
  await waitForNewestMockMessage(page);
  const container = messagesContainer(page);
  await waitForStableScroll(container);
  const firstPage = await getMockMessageNumbers(page);
  const loadedBefore = await getLoadedMessageCount(page);

  expect(loadedBefore).toBe(PAGE_SIZE);
  expect(Math.max(...firstPage)).toBe(NEWEST_MOCK_MESSAGE);
  expect(firstPage.length).toBeLessThan(MAX_RENDERED_MESSAGES);

  await wheelUpUntil(
    page,
    container,
    async () => (await getLoadedMessageCount(page)) > loadedBefore
  );
  const visible = await getMockMessageNumbers(page);
  expect(Math.min(...visible)).toBeLessThan(
    NEWEST_MOCK_MESSAGE - PAGE_SIZE + 1
  );
  expect(visible).toEqual([...visible].sort((a, b) => a - b));
  expect(Math.max(...visible) - Math.min(...visible) + 1).toBe(visible.length);
  expect(await messageItems(page).count()).toBeLessThan(MAX_RENDERED_MESSAGES);
});

test('a thousand loaded messages keep bounded DOM and remain reachable by keyboard', async ({
  page
}) => {
  await loginAs(page, 'testowner', 'password123');
  await openChannel(page, INFINITE_SCROLL_CHANNEL);
  await waitForNewestMockMessage(page);
  const container = messagesContainer(page);
  await container.focus();

  await expect
    .poll(
      async () => {
        await page.keyboard.press('Home');
        return getLoadedMessageCount(page);
      },
      { timeout: 60_000 }
    )
    .toBe(NEWEST_MOCK_MESSAGE);

  expect(await messageItems(page).count()).toBeLessThan(MAX_RENDERED_MESSAGES);
  await page.keyboard.press('Home');
  await expect
    .poll(async () => Math.min(...(await getMockMessageNumbers(page))))
    .toBe(1);
  await page.keyboard.press('End');
  await waitForNewestMockMessage(page);
  expect(await messageItems(page).count()).toBeLessThan(MAX_RENDERED_MESSAGES);
});

test('switching back retains cached pages without mounting the entire history', async ({
  page
}) => {
  await loginAs(page, 'testowner', 'password123');
  await openChannel(page, INFINITE_SCROLL_CHANNEL);
  await waitForNewestMockMessage(page);
  const container = messagesContainer(page);
  await container.focus();
  await expect
    .poll(async () => {
      await page.keyboard.press('Home');
      return getLoadedMessageCount(page);
    })
    .toBeGreaterThanOrEqual(PAGE_SIZE * 3);
  const loadedBefore = await getLoadedMessageCount(page);

  await openChannel(page, 'General');
  await openChannel(page, INFINITE_SCROLL_CHANNEL);
  await waitForNewestMockMessage(page);

  expect(await getLoadedMessageCount(page)).toBeGreaterThanOrEqual(
    loadedBefore
  );
  expect(await messageItems(page).count()).toBeLessThan(MAX_RENDERED_MESSAGES);
  expect(Math.max(...(await getMockMessageNumbers(page)))).toBe(
    NEWEST_MOCK_MESSAGE
  );
});

test('jumping to an old message shows a bounded window and a way back', async ({
  page
}) => {
  await loginAs(page, 'testowner', 'password123');
  await openChannel(page, INFINITE_SCROLL_CHANNEL);
  await waitForNewestMockMessage(page);
  await jumpTo(page, 150);

  const windowNumbers = await getMockMessageNumbers(page);
  expect(Math.max(...windowNumbers)).toBeLessThan(NEWEST_MOCK_MESSAGE);
  expect(windowNumbers).toEqual([...windowNumbers].sort((a, b) => a - b));
  expect(await messageItems(page).count()).toBeLessThan(MAX_RENDERED_MESSAGES);
  const returnToPresent = page.getByTestId(TestId.RETURN_TO_PRESENT);
  await expect(returnToPresent).toBeVisible();
  await returnToPresent.click();
  await expect(returnToPresent).toBeHidden();
  await waitForNewestMockMessage(page);
});

test('a loaded but unmounted search target is mounted and highlighted without detaching', async ({
  page
}) => {
  await loginAs(page, 'testowner', 'password123');
  await openChannel(page, INFINITE_SCROLL_CHANNEL);
  await waitForNewestMockMessage(page);
  const container = messagesContainer(page);
  await container.focus();
  await expect
    .poll(async () => {
      await page.keyboard.press('Home');
      return getLoadedMessageCount(page);
    })
    .toBeGreaterThanOrEqual(PAGE_SIZE * 3);
  await page.keyboard.press('End');
  await waitForNewestMockMessage(page);

  expect(await getMockMessageNumbers(page)).not.toContain(850);
  await jumpTo(page, 850);
  const target = messageItems(page).filter({ hasText: 'Mock message 850' });
  await expect(target).toHaveClass(/bg-secondary/);
  await expect(page.getByTestId(TestId.RETURN_TO_PRESENT)).toBeHidden();
});

test('a second jump that reaches the present reattaches the channel', async ({
  page
}) => {
  await loginAs(page, 'testowner', 'password123');
  await openChannel(page, INFINITE_SCROLL_CHANNEL);
  await waitForNewestMockMessage(page);
  const returnToPresent = page.getByTestId(TestId.RETURN_TO_PRESENT);
  await jumpTo(page, 150);
  await expect(returnToPresent).toBeVisible();
  await jumpTo(page, 950);
  await expect(returnToPresent).toBeHidden();

  const numbers = await getMockMessageNumbers(page);
  expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  expect(Math.max(...numbers) - Math.min(...numbers) + 1).toBe(numbers.length);
  const container = messagesContainer(page);
  await container.focus();
  await page.keyboard.press('End');
  await waitForNewestMockMessage(page);
});
