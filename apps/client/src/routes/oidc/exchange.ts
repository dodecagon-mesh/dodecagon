import {
  getOidcHandoffCode,
  getServerBridge,
  isHttpServiceError
} from '@dodecagon/shared';
import { createFileRoute } from '@tanstack/react-router';
import { readJsonBody, toRequestContext } from '../-request';
import {
  toErrorResponse,
  toInternalErrorResponse,
  toJsonResponse
} from '../-response';

export const Route = createFileRoute('/oidc/exchange')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const bridge = getServerBridge();
          const code = getOidcHandoffCode(await readJsonBody(request));
          const result = await bridge.consumeOidcHandoff(
            code,
            toRequestContext(request)
          );

          const headers: Record<string, string> = {
            'Cache-Control': 'no-store'
          };

          if (result.cookie) {
            headers['Set-Cookie'] = result.cookie;
          }

          return toJsonResponse(
            { success: true, token: result.token },
            200,
            headers
          );
        } catch (error) {
          if (isHttpServiceError(error)) {
            return toErrorResponse({ ok: false, error: error.error });
          }

          return toInternalErrorResponse();
        }
      }
    }
  }
});
