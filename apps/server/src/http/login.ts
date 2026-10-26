import type { TLoginInput } from '@dodecagon/shared';
import type http from 'http';
import type { getWsInfo } from '../helpers/get-ws-info';
import { authenticateUserService } from '../helpers/services/auth';
import {
  getJsonBody,
  getPublicOrigin,
  isSecureRequest,
  sendServiceError
} from './helpers';

// the service owns the login rules, this route only reads the body and writes the answer
const loginRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  { info }: { info: ReturnType<typeof getWsInfo> }
) => {
  // the body is not validated here, the service owns the rules and answers the same field
  // errors the start route answers
  const input = await getJsonBody<TLoginInput>(req);

  const result = await authenticateUserService(input, {
    origin: getPublicOrigin(req),
    ip: info?.ip,
    secure: isSecureRequest(req),
    cookie: req.headers.cookie
  });

  if (!result.ok) {
    await sendServiceError(res, result.error);

    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, token: result.body.token }));
};

export { loginRouteHandler };
