import { getOidcHandoffCode } from '@dodecagon/shared';
import type http from 'http';
import type { getWsInfo } from '../../helpers/get-ws-info';
import { consumeOidcHandoffService } from '../../helpers/services/oidc';
import {
  getJsonBody,
  getPublicOrigin,
  isSecureRequest,
  sendServiceError
} from '../helpers';

// the service validates the code, this route only reads the body and writes the answer
const oidcExchangeRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  { info }: { info: ReturnType<typeof getWsInfo> }
) => {
  const body = await getJsonBody(req);

  const result = await consumeOidcHandoffService(getOidcHandoffCode(body), {
    origin: getPublicOrigin(req),
    ip: info?.ip,
    secure: isSecureRequest(req),
    cookie: req.headers.cookie
  });

  if (!result.ok) {
    await sendServiceError(res, result.error);

    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  if (result.body.cookie) {
    headers['Set-Cookie'] = result.body.cookie;
  }

  res.writeHead(200, headers);
  res.end(JSON.stringify({ success: true, token: result.body.token }));
};

export { oidcExchangeRouteHandler };
