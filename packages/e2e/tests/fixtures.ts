import {
  expect,
  test as base,
  type Browser,
  type Page
} from '@playwright/test';
import { TestId } from '@dodecagon/shared';

// the server hands the html of the screen, the browser takes over a moment
// later. until then the form does not react, so the tests have to wait for the
// hydration before they touch the interface
const waitForHydration = async (page: Page) => {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: 'attached', timeout: 20_000 });
};

const withHydration = (page: Page): Page => {
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);

  page.goto = async (...args: Parameters<Page['goto']>) => {
    const response = await goto(...args);

    await waitForHydration(page);

    return response;
  };

  page.reload = async (...args: Parameters<Page['reload']>) => {
    const response = await reload(...args);

    await waitForHydration(page);

    return response;
  };

  return page;
};

// the tests open their own contexts for a second client, those pages have to
// wait for the hydration as well
const withHydratedContexts = (browser: Browser): Browser => {
  const newContext = browser.newContext.bind(browser);

  browser.newContext = async (...args: Parameters<Browser['newContext']>) => {
    const context = await newContext(...args);
    const newPage = context.newPage.bind(context);

    context.newPage = async (...pageArgs: Parameters<typeof newPage>) =>
      withHydration(await newPage(...pageArgs));

    return context;
  };

  return browser;
};

const test = base.extend<{ browser: Browser; page: Page }>({
  browser: async ({ browser }, use) => {
    await use(withHydratedContexts(browser));
  },
  page: async ({ page }, use) => {
    await use(withHydration(page));
  }
});

const loginAs = async (page: Page, identity: string, password: string) => {
  await page.goto('/');
  await waitForHydration(page);

  const identityInput = page.getByTestId(TestId.CONNECT_IDENTITY_INPUT);
  const serverView = page.getByTestId(TestId.SERVER_VIEW);

  // a second page in the same context can already carry the session of the
  // first one; there is nothing to submit then
  await expect(identityInput.or(serverView)).toBeVisible();

  if (!(await identityInput.isVisible())) return;

  await identityInput.fill(identity);
  await page.getByTestId(TestId.CONNECT_PASSWORD_INPUT).fill(password);
  await page.getByTestId(TestId.CONNECT_BUTTON).click();
  await serverView.waitFor();
};

export { expect, loginAs, test, waitForHydration };
