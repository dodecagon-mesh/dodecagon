import { expect, test } from '@playwright/test';
import { loginAs } from './fixtures';
import {
  INFINITE_SCROLL_CHANNEL,
  LIVE_MESSAGES_CHANNEL,
  MEDIA_CHANNEL,
  openChannel
} from './helpers/channels';
import { withSecondClient } from './helpers/clients';
import {
  getLoadedMessageCount,
  LIVE_MESSAGES_NEWEST,
  messageByText,
  messageItems,
  sendMessage,
  waitForNewestMockMessage
} from './helpers/messages';
import {
  BOTTOM_THRESHOLD,
  expectAtBottom,
  messagesContainer,
  readReadingAnchor,
  readScroll,
  scrollWellAwayFromBottom,
  waitForStableScroll,
  wheelUpUntil
} from './helpers/scroll';

// where the viewport sits, and what is allowed to move it. everything here drives the
// container with real wheel input: writing scrollTop and hand-dispatching a 'scroll' event
// makes the handler run twice per scroll and hides exactly the ordering bugs this covers

// the specs that only read use the untouched channel, the ones that send use the channel
// set aside for writes, so a message one spec sends cannot move another spec's pages
const openMockChannel = async (
  page: Parameters<typeof loginAs>[0],
  channel: string
) => {
  await openChannel(page, channel);
  await waitForNewestMockMessage(
    page,
    channel === LIVE_MESSAGES_CHANNEL ? LIVE_MESSAGES_NEWEST : undefined
  );

  const container = messagesContainer(page);

  await waitForStableScroll(container);

  return container;
};

test('a channel opens at the bottom', async ({ page }) => {
  await loginAs(page, 'testowner', 'password123');

  const container = await openMockChannel(page, INFINITE_SCROLL_CHANNEL);

  await expectAtBottom(container);
});

// messages carrying images and video only reach their final height once the media loads, so
// the view has to keep following the bottom until it settles. scrollToBottom fires the scroll
// handler itself, and reading that mid-settle position back as "the user left the bottom" is
// what stopped this channel ever arriving there
test('a channel full of media opens at the bottom and stays there', async ({
  page
}) => {
  await loginAs(page, 'testowner', 'password123');
  await openChannel(page, MEDIA_CHANNEL);

  const container = messagesContainer(page);

  await expect(messageItems(page).first()).toBeVisible();

  // a generous window on purpose: a thousand messages of media, and the suite runs several
  // browsers at once. the assertion is that it arrives at all, not how fast
  await expect
    .poll(async () => (await readScroll(container)).fromBottom, {
      timeout: 30_000
    })
    .toBeLessThanOrEqual(BOTTOM_THRESHOLD);

  await waitForStableScroll(container);

  expect((await readScroll(container)).fromBottom).toBeLessThanOrEqual(
    BOTTOM_THRESHOLD
  );
});

// the regression this file exists for. chrome's scroll anchoring already compensates for
// content inserted above the viewport, so a restore computed from the growth in scrollHeight
// applies that compensation a second time and lands at the bottom.
//
// the trigger has to stop just short of the top and never on it: anchoring is suppressed at
// exactly scrollTop 0, and there the old arithmetic happened to be right
test('paging up holds the reading position', async ({ page }) => {
  await loginAs(page, 'testowner', 'password123');

  const container = await openMockChannel(page, INFINITE_SCROLL_CHANNEL);
  const loadedBefore = await getLoadedMessageCount(page);

  await scrollWellAwayFromBottom(page, container);

  // require a fetched page, not merely an older virtual row becoming visible while scrolling
  let closestToBottom = Number.POSITIVE_INFINITY;

  await wheelUpUntil(page, container, async () => {
    closestToBottom = Math.min(
      closestToBottom,
      (await readScroll(container)).fromBottom
    );

    return (await getLoadedMessageCount(page)) > loadedBefore;
  });

  await waitForStableScroll(container);

  const settled = await readScroll(container);

  expect(closestToBottom).toBeGreaterThan(BOTTOM_THRESHOLD);
  expect(settled.fromBottom).toBeGreaterThan(BOTTOM_THRESHOLD);
});

test('sending a message from the bottom keeps the sender at the bottom', async ({
  page
}) => {
  await loginAs(page, 'testowner', 'password123');

  const container = await openMockChannel(page, LIVE_MESSAGES_CHANNEL);

  await expectAtBottom(container);

  await sendMessage(page, `Own message from the bottom ${Date.now()}`);

  await expectAtBottom(container);
});

test('sending a message while scrolled up sends it without yanking the view down', async ({
  page
}) => {
  await loginAs(page, 'testowner', 'password123');

  const container = await openMockChannel(page, LIVE_MESSAGES_CHANNEL);

  await scrollWellAwayFromBottom(page, container);
  const before = await readReadingAnchor(container);

  const content = `Own message while scrolled up ${Date.now()}`;

  await sendMessage(page, content, { waitForVisible: false });

  const after = await readReadingAnchor(container);
  expect(after.messageId).toBe(before.messageId);
  expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(2);
  // sending is a deliberate act, but it is not a request to leave the history being read
  expect((await readScroll(container)).fromBottom).toBeGreaterThan(
    BOTTOM_THRESHOLD
  );
  await container.focus();
  await page.keyboard.press('End');
  await expectAtBottom(container);
  await expect(messageByText(page, content)).toHaveCount(1);
});

test('a message from someone else keeps a reader at the bottom', async ({
  page,
  browser
}) => {
  await loginAs(page, 'testowner', 'password123');

  const container = await openMockChannel(page, LIVE_MESSAGES_CHANNEL);

  await expectAtBottom(container);

  await withSecondClient(browser, 'testuser', 'password123', async (sender) => {
    await openChannel(sender, LIVE_MESSAGES_CHANNEL);

    const content = `Incoming while at bottom ${Date.now()}`;

    await sendMessage(sender, content);
    await expect(messageByText(page, content)).toHaveCount(1);

    await expectAtBottom(container);
  });
});

test('a message from someone else does not pull a scrolled-up reader down', async ({
  page,
  browser
}) => {
  await loginAs(page, 'testowner', 'password123');

  const container = await openMockChannel(page, LIVE_MESSAGES_CHANNEL);
  await scrollWellAwayFromBottom(page, container);
  const before = await readReadingAnchor(container);

  await withSecondClient(browser, 'testuser', 'password123', async (sender) => {
    await openChannel(sender, LIVE_MESSAGES_CHANNEL);

    const content = `Incoming while scrolled up ${Date.now()}`;

    await sendMessage(sender, content);

    const sentMessageId = await messageByText(sender, content).getAttribute(
      'data-message-id'
    );
    await expect(container).toHaveAttribute(
      'data-newest-message-id',
      sentMessageId!
    );

    const after = await readReadingAnchor(container);
    expect(after.messageId).toBe(before.messageId);
    expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(2);
    expect((await readScroll(container)).fromBottom).toBeGreaterThan(
      BOTTOM_THRESHOLD
    );
    await container.focus();
    await page.keyboard.press('End');
    await expectAtBottom(container);
    await expect(messageByText(page, content)).toHaveCount(1);
  });
});
