import { createServerFn } from '@tanstack/react-start';
import { readBrowserRequestContext } from './read-browser-request-context';

// the language, the state of the connection and the time of the request belong
// to the request, so they are read on the server and handed to the browser
const getRequestContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    // the reader of the request lives in a module of its own, so the import of
    // the server stays out of the bundle of the browser
    const { readServerRequestContext } = await import('./read-request-context');

    return readServerRequestContext();
  }
);

// the browser reads the same values from itself, so a navigation never waits on
// the network and a failed call cannot take the whole app down
export const readRequestContext = async () =>
  typeof window === 'undefined'
    ? await getRequestContext()
    : readBrowserRequestContext();
