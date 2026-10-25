import { expect, type Locator, type Page } from '@playwright/test';
import { TestId } from '@dodecagon/shared';

// the seeded "Infinite Scroll" channel holds "Mock message 1" through "Mock message 1000",
// oldest first, which is what lets a test say where in the history it is looking
const NEWEST_MOCK_MESSAGE = 1000;

// the write channel numbers from 2001 so a search for one channel's message cannot match the
// other's, which would let a jump land in the wrong channel
const LIVE_MESSAGES_NEWEST = 2300;

const messageItems = (page: Page): Locator =>
  page.getByTestId(TestId.MESSAGE_ITEM);

const messageByText = (page: Page, content: string): Locator =>
  messageItems(page).filter({ hasText: content });

const composeEditor = (page: Page): Locator =>
  page.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR).first();

const getMockMessageNumbers = async (page: Page): Promise<number[]> =>
  (await messageItems(page).allTextContents())
    .map((text) => text.match(/Mock message (\d+)/)?.[1])
    .filter((value): value is string => !!value)
    .map(Number);

const getLoadedMessageCount = async (page: Page): Promise<number> =>
  Number(await page.locator('[data-messages-container]').getAttribute('data-loaded-message-count'));

// the first page ends at the channel's newest mock message, so its presence is the signal
// that the channel has finished loading rather than an arbitrary wait
const waitForNewestMockMessage = async (
  page: Page,
  newest: number = NEWEST_MOCK_MESSAGE
) => {
  await expect(messageItems(page).first()).toBeVisible();

  await expect
    .poll(async () => {
      const numbers = await getMockMessageNumbers(page);

      return numbers.length > 0 ? Math.max(...numbers) : null;
    })
    // at least, not exactly: a spec that sends into this channel pushes the newest mock
    // message down the list but never removes it
    .toBeGreaterThanOrEqual(newest);
};

const sendMessage = async (
  page: Page,
  content: string,
  options: { waitForVisible?: boolean } = {}
) => {
  const editor = composeEditor(page);
  const loadedBefore = await getLoadedMessageCount(page);

  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press('ControlOrMeta+A');
  await editor.press('Backspace');
  await editor.pressSequentially(content);
  await expect(editor).toContainText(content);

  await editor.press('Enter');
  await expect(editor).toHaveText('');

  if (options.waitForVisible !== false) {
    await expect(messageByText(page, content)).toHaveCount(1);
  } else {
    await expect.poll(() => getLoadedMessageCount(page)).toBeGreaterThan(loadedBefore);
    await expect(page.locator('[data-message-delivery="sending"]')).toHaveCount(0);
  }
};

export {
  getMockMessageNumbers,
  getLoadedMessageCount,
  messageByText,
  messageItems,
  LIVE_MESSAGES_NEWEST,
  NEWEST_MOCK_MESSAGE,
  sendMessage,
  waitForNewestMockMessage
};
