import { TestId } from '@dodecagon/shared';
import { expect, loginAs, test } from './fixtures';
import { LIVE_MESSAGES_CHANNEL, openChannel } from './helpers/channels';
import { messageByText, waitForNewestMockMessage } from './helpers/messages';

// hold the real transport rather than substituting an onSend callback, so the
// composer, pending history, server mutation and subscription all stay real
const holdMessageSends = async (page: Parameters<typeof loginAs>[0]) => {
  await page.addInitScript(() => {
    const nativeSend = WebSocket.prototype.send;
    const held: {
      socket: WebSocket;
      data: Parameters<WebSocket['send']>[0];
    }[] = [];
    const gate = {
      held: 0,
      enabled: true,
      release: () => {
        gate.enabled = false;
        const pending = held.splice(0);
        gate.held = 0;
        for (const { socket, data } of pending) nativeSend.call(socket, data);
      }
    };

    Object.defineProperty(globalThis, '__messageSendGate', { value: gate });

    WebSocket.prototype.send = function (data) {
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          const requests = Array.isArray(parsed) ? parsed : [parsed];
          if (
            gate.enabled &&
            requests.some((request) => request.params?.path === 'messages.send')
          ) {
            held.push({ socket: this, data });
            gate.held = held.length;
            return;
          }
        } catch {
          // websocket heartbeat frames are not JSON requests
        }
      }
      nativeSend.call(this, data);
    };
  });
};

const heldSends = (page: Parameters<typeof loginAs>[0]) =>
  page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __messageSendGate: { held: number };
    };
    return target.__messageSendGate.held;
  });

const releaseSends = (page: Parameters<typeof loginAs>[0]) =>
  page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __messageSendGate: { release: () => void };
    };
    target.__messageSendGate.release();
  });

test('a held send leaves the editor free and its next draft survives confirmation', async ({
  page
}) => {
  await holdMessageSends(page);
  await loginAs(page, 'testowner', 'password123');
  await openChannel(page, LIVE_MESSAGES_CHANNEL);
  await waitForNewestMockMessage(page);

  const editor = page.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR);
  const content = `Held message ${Date.now()}`;
  await editor.fill(content);
  await editor.press('Enter');
  await expect.poll(() => heldSends(page)).toBeGreaterThan(0);

  try {
    await expect(editor).toHaveText('');
    await expect(
      page
        .locator('[data-message-delivery="sending"]')
        .filter({ hasText: content })
    ).toBeVisible();
    await editor.fill('The next draft stays here');
    await editor.press('End');
    await editor.press('!');
    await expect(editor).toHaveText('The next draft stays here!');
  } finally {
    await releaseSends(page);
  }
  await expect(page.locator('[data-message-delivery="sending"]')).toHaveCount(
    0
  );

  await expect(messageByText(page, content)).toHaveCount(1);
  await expect(editor).toHaveText('The next draft stays here!');
  await page.reload();
  await expect(page.getByTestId(TestId.SERVER_VIEW)).toBeVisible();
  await openChannel(page, LIVE_MESSAGES_CHANNEL);
  await expect(messageByText(page, content)).toHaveCount(1);
  await expect(page.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR)).toHaveText(
    'The next draft stays here!'
  );
});

test('several messages can queue before the transport is released', async ({
  page
}) => {
  await holdMessageSends(page);
  await loginAs(page, 'testowner', 'password123');
  await openChannel(page, LIVE_MESSAGES_CHANNEL);
  await waitForNewestMockMessage(page);

  const editor = page.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR);
  const prefix = `Rapid message ${Date.now()}`;
  const contents = [`${prefix} first`, `${prefix} second`, `${prefix} third`];

  try {
    for (const content of contents) {
      await editor.fill(content);
      await editor.press('Enter');
      await expect(editor).toHaveText('');
      await expect(
        page
          .locator('[data-message-delivery="sending"]')
          .filter({ hasText: content })
      ).toBeVisible();
    }
  } finally {
    await releaseSends(page);
  }
  await expect(page.locator('[data-message-delivery="sending"]')).toHaveCount(
    0
  );
  for (const content of contents) {
    await expect(messageByText(page, content)).toHaveCount(1);
  }

  await page.reload();
  await expect(page.getByTestId(TestId.SERVER_VIEW)).toBeVisible();
  await openChannel(page, LIVE_MESSAGES_CHANNEL);
  for (const content of contents) {
    await expect(messageByText(page, content)).toHaveCount(1);
  }
});

test('a fresh channel revisit reuses the loaded page instead of fetching it again', async ({
  page
}) => {
  let pageRequests = 0;
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string') return;
      try {
        const parsed = JSON.parse(payload);
        const requests = Array.isArray(parsed) ? parsed : [parsed];
        pageRequests += requests.filter(
          (request) => request.params?.path === 'messages.get'
        ).length;
      } catch {
        // ignore heartbeat frames
      }
    });
  });

  await loginAs(page, 'testowner', 'password123');
  await openChannel(page, 'Infinite Scroll');
  await waitForNewestMockMessage(page, 1000);
  await openChannel(page, LIVE_MESSAGES_CHANNEL);
  await waitForNewestMockMessage(page, 2300);
  const requestsBeforeRevisit = pageRequests;

  await openChannel(page, 'Infinite Scroll');
  await expect(messageByText(page, 'Mock message 1000')).toBeVisible();
  // observe the next painted channel, after its mount effects have run
  await page.evaluate(() => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const target = globalThis as typeof globalThis & {
      requestAnimationFrame: (callback: () => void) => number;
    };
    target.requestAnimationFrame(() => target.requestAnimationFrame(resolve));
    return promise;
  });
  expect(pageRequests).toBe(requestsBeforeRevisit);
});

test('saving one channel draft does not erase a draft from another window', async ({
  page,
  context
}) => {
  const prefix = `Multiwindow draft ${Date.now()}`;
  await loginAs(page, 'testowner', 'password123');
  await openChannel(page, 'Infinite Scroll');
  const first = page.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR);
  await first.fill(`${prefix} A first`);
  await expect
    .poll(() =>
      page.evaluate(
        (text) =>
          Object.values(localStorage).some((value) => value.includes(text)),
        `${prefix} A first`
      )
    )
    .toBe(true);

  const other = await context.newPage();
  try {
    await loginAs(other, 'testowner', 'password123');
    await openChannel(other, LIVE_MESSAGES_CHANNEL);
    await other.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR).fill(`${prefix} B`);
    await expect
      .poll(() =>
        other.evaluate(
          (text) =>
            Object.values(localStorage).some((value) => value.includes(text)),
          `${prefix} B`
        )
      )
      .toBe(true);

    await first.fill(`${prefix} A second`);
    await page.reload();
    await expect(page.getByTestId(TestId.SERVER_VIEW)).toBeVisible();
    await openChannel(page, 'Infinite Scroll');
    await expect(page.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR)).toHaveText(
      `${prefix} A second`
    );

    await other.reload();
    await expect(other.getByTestId(TestId.SERVER_VIEW)).toBeVisible();
    await openChannel(other, LIVE_MESSAGES_CHANNEL);
    await expect(other.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR)).toHaveText(
      `${prefix} B`
    );
  } finally {
    await other.close();
  }
});
