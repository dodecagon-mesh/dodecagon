import { TestId } from '@dodecagon/shared';
import { expect, test, waitForHydration } from './fixtures';

// the production build reports the mismatch of the hydration with a minified
// number, the development build names it in the warning of react
const isHydrationError = (message: string) =>
  /Minified React error #(?:418|423|425)|Hydration failed|hydration mismatch|Text content did not match|error occurred during hydration|error while hydrating/i.test(
    message
  );

// the browser asks in russian, so the server renders the page in russian. the
// locale of the context sets the header of the request and the language of the
// browser at the same time, the header alone would be overruled by it
test.use({ locale: 'ru-RU' });

// the server renders every request in the language of the browser, but the
// language of the user can be another one. the browser has to load the
// resources of that language, otherwise the interface shows the raw keys
test('shows the language of the user when the request carries another one', async ({
  page
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('dodecagon-language', 'en');
  });
  await page.context().addCookies([
    {
      name: 'dodecagon-language',
      value: 'en',
      domain: 'localhost',
      path: '/'
    }
  ]);

  await page.goto('/');
  await waitForHydration(page);

  const identity = page.getByTestId(TestId.CONNECT_IDENTITY_INPUT);
  const password = page.getByTestId(TestId.CONNECT_PASSWORD_INPUT);

  await expect(identity).toBeVisible();
  await expect(identity).toHaveAttribute('aria-label', 'Identity');
  await expect(password).toHaveAttribute('aria-label', 'Password');
});

// the choice of the older versions lives in the storage of the browser only,
// the server does not know it and renders the page in the language of the
// request. the page asks for itself again with the cookie of the language,
// then the server renders it in the language of the user and the text of the
// server and the text of the browser match
test('takes over the language of the user without a mismatch of the hydration', async ({
  page
}) => {
  const hydrationErrors: string[] = [];
  const documents: string[] = [];

  page.on('pageerror', (error) => {
    if (isHydrationError(error.message)) hydrationErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && isHydrationError(message.text())) {
      hydrationErrors.push(message.text());
    }
  });
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents.push(request.url());
  });

  await page.addInitScript(() => {
    localStorage.setItem('dodecagon-language', 'en');
  });

  await page.goto('/');
  await waitForHydration(page);

  const identity = page.getByTestId(TestId.CONNECT_IDENTITY_INPUT);
  const password = page.getByTestId(TestId.CONNECT_PASSWORD_INPUT);

  await expect(identity).toBeVisible();
  await expect(identity).toHaveAttribute('aria-label', 'Identity');
  await expect(password).toHaveAttribute('aria-label', 'Password');

  // the cookie carries the language of the user to the server
  await expect
    .poll(
      async () =>
        (await page.context().cookies()).find(
          (cookie) => cookie.name === 'dodecagon-language'
        )?.value
    )
    .toBe('en');

  // the page asked for itself again, because the request that was already
  // running could not carry the cookie. the root renders a waiting shell rather
  // than redirecting to the form of the sign in, so the reload is one extra
  // document on top of the first one, not two
  expect(documents.length).toBeGreaterThan(1);

  expect(hydrationErrors).toEqual([]);
});
