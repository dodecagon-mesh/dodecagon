import { TestId } from '@dodecagon/shared';
import type { Page } from '@playwright/test';
import { expect, test, waitForHydration } from './fixtures';

// the id of a server function decodes to the module that holds it, so a test
// can tell which call it is looking at
const readServerFunctionSource = (url: string) =>
  Buffer.from(url.split('/_serverFn/')[1] ?? '', 'base64url').toString();

// the loaders of the page run again the way a navigation or a stale tab runs
// them, without waiting for the stale time of the root route
const reloadLoaders = (page: Page) =>
  page.evaluate(() => {
    const scope: unknown = globalThis;

    if (!scope || typeof scope !== 'object' || !('__TSR_ROUTER__' in scope)) {
      throw new Error('the router is not exposed on window');
    }

    const router = scope.__TSR_ROUTER__;

    if (!router || typeof router !== 'object' || !('invalidate' in router)) {
      throw new Error('the router does not expose invalidate');
    }

    const { invalidate } = router;

    if (typeof invalidate !== 'function') {
      throw new Error('invalidate is not a function');
    }

    invalidate.call(router);
  });

test.describe('a server function that fails', () => {
  test('does not ask the server for the request context of the browser', async ({
    page
  }) => {
    const calls: string[] = [];

    page.on('request', (request) => {
      if (!request.url().includes('/_serverFn/')) return;

      calls.push(readServerFunctionSource(request.url()));
    });

    await page.goto('/');
    await waitForHydration(page);
    await expect(page.getByTestId(TestId.CONNECT_IDENTITY_INPUT)).toBeVisible();

    await reloadLoaders(page);

    await expect(page.getByTestId(TestId.CONNECT_IDENTITY_INPUT)).toBeVisible();
    // the loaders really ran again, so the absence below means something
    expect(calls.some((call) => call.includes('server-functions.ts'))).toBe(
      true
    );
    expect(calls.filter((call) => call.includes('request-context.ts'))).toEqual(
      []
    );
  });

  test('leaves a usable screen instead of replacing the app', async ({
    page
  }) => {
    await page.goto('/');
    await waitForHydration(page);
    await expect(page.getByTestId(TestId.CONNECT_IDENTITY_INPUT)).toBeVisible();

    await page.route('**/_serverFn/**', (route) =>
      route.abort('connectionreset')
    );
    await reloadLoaders(page);

    const retry = page.getByRole('button', { name: 'Retry' });

    await expect(retry).toBeVisible();
    await expect(page.getByText('Something went wrong!')).toHaveCount(0);

    await page.unroute('**/_serverFn/**');
    await retry.click();

    await expect(page.getByTestId(TestId.CONNECT_IDENTITY_INPUT)).toBeVisible();
  });
});
