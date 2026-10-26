import type http from 'http';
import type { getWsInfo } from '../../helpers/get-ws-info';
import { createOidcLoginService } from '../../helpers/services/oidc';
import {
  getPublicOrigin,
  isSecureRequest,
  sendRedirect,
  sendServiceError
} from '../helpers';

// the service owns the flow, this route only hands it the request and writes the redirect
const oidcLoginRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  { info }: { info: ReturnType<typeof getWsInfo> }
) => {
  const result = await createOidcLoginService({
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

export { oidcLoginRouteHandler };
