import { getServerBridge, toOidcCallbackInput } from '@dodecagon/shared';
import { createFileRoute } from '@tanstack/react-router';
import { toRequestContext } from '../-request';
import { toInternalErrorResponse, toRedirectResponse } from '../-response';

export const Route = createFileRoute('/oidc/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const bridge = getServerBridge();
          const url = new URL(request.url);
          // the provider gets the whole search of the callback, the token request
          // has to carry every parameter it sent
          const result = await bridge.consumeOidcCallback(
            toOidcCallbackInput(url),
            toRequestContext(request)
          );

          return toRedirectResponse(result.location, result.cookie);
        } catch {
          return toInternalErrorResponse();
        }
      }
    }
  }
});
