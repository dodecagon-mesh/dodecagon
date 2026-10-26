import { toOidcCallbackInput } from '@dodecagon/shared';
import type http from 'http';
import type { getWsInfo } from '../../helpers/get-ws-info';
import { consumeOidcCallbackService } from '../../helpers/services/oidc';
import {
  getPublicOrigin,
  isSecureRequest,
  sendRedirect,
  sendServiceError
} from '../helpers';

// the service completes the callback, this route only builds its input and writes the
// redirect it answered with
const oidcCallbackRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  { info, url }: { info: ReturnType<typeof getWsInfo>; url: URL }
) => {
  const result = await consumeOidcCallbackService(toOidcCallbackInput(url), {
    origin: getPublicOrigin(req),
    ip: info?.ip,
    secure: isSecureRequest(req),
    cookie: req.headers.cookie
  });

  if (!result.ok) {
    await sendServiceError(res, result.error);

    return;
  }

  sendRedirect(res, result.body.location, result.body.cookie);
};

export { oidcCallbackRouteHandler };
