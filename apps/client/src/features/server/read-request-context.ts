import { isSecureRequest } from '@/helpers/is-secure-request';
import { detectLanguageFromCookie, detectLanguageFromHeader } from '@/i18n';
import { readPublicSentryDsn } from '@dodecagon/shared';
import { getRequest } from '@tanstack/react-start/server';

// the server has no local storage and no navigator, so the language and the
// state of the connection come from the request of the browser
const readServerRequestContext = async () => {
  const request = getRequest();
  const url = new URL(request.url);

  return {
    // the language of the user travels in a cookie, the header of the browser
    // is only the guess of the server
    language:
      detectLanguageFromCookie(request.headers.get('cookie')) ??
      detectLanguageFromHeader(request.headers.get('accept-language')),
    isSecure: isSecureRequest(request),
    search: url.search,
    now: Date.now(),
    // the page reports its own errors before anyone signs in, so the dsn and
    // the environment of this deployment travel in the html of every request.
    // they are meaningless in the browser, which cannot read the environment of
    // the server
    sentry: {
      dsn: readPublicSentryDsn(process.env),
      environment: process.env.SENTRY_ENVIRONMENT?.trim() || null
    }
  };
};

export { readServerRequestContext };
