import { getBrowserLanguage } from '@/i18n';

// the browser already holds everything the request of a page carries, so the
// boot of the app and its navigations do not need a call to the server
const readBrowserRequestContext = () => ({
  language: getBrowserLanguage(),
  isSecure: window.isSecureContext,
  now: Date.now()
});

export { readBrowserRequestContext };
