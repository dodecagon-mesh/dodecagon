import type http from 'http';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { logger } from '../logger';
import { COMPRESSIBLE_CONTENT_TYPE, getPreferredEncoding } from './compression';

// the start server speaks the web fetch api, the bun http server speaks node
// streams, so every request has to cross that boundary before the route sees it
type TWebRequestInit = RequestInit & { duplex?: 'half' };

// the dispatcher resolves the client ip, the public origin and the body limit
// before the request leaves bun, because the start server cannot see the socket
// and must not trust the headers of the caller
const toWebRequest = (
  req: http.IncomingMessage,
  url: URL,
  extraHeaders?: Record<string, string>
): Request => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }

      continue;
    }

    headers.set(key, value);
  }

  for (const [key, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(key, value);
  }

  const method = req.method ?? 'GET';
  const init: TWebRequestInit = { method, headers };

  // a body is only allowed on the methods that can carry one
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }

  // the url object is not accepted by the request constructor without the dom lib
  return new Request(url.toString(), init);
};

const sendWebResponse = async (
  res: http.ServerResponse,
  response: Response
): Promise<void> => {
  res.statusCode = response.status;

  // the cookie header can repeat and a plain iteration would fold the repeats into
  // one comma separated value, which the browser would read as a single broken cookie
  const cookies = response.headers.getSetCookie();

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;

    res.setHeader(key, value);
  });

  if (cookies.length > 0) {
    res.setHeader('set-cookie', cookies);
  }

  const contentType = response.headers.get('content-type');
  const contentLength = response.headers.get('content-length');
  const compressible =
    response.status === 200 &&
    response.body !== null &&
    !!contentType &&
    COMPRESSIBLE_CONTENT_TYPE.test(contentType) &&
    !response.headers.get('content-encoding') &&
    (contentLength === null || Number(contentLength) >= 1024);
  const encoding = compressible ? getPreferredEncoding(res.req) : undefined;

  // the html of the router is generated per request and must be revalidated, not
  // guessed from the time of the last visit
  if (contentType?.startsWith('text/html') && !res.hasHeader('cache-control')) {
    res.setHeader('Cache-Control', 'no-cache');
  }

  if (compressible) {
    const vary = res.getHeader('vary');

    res.setHeader(
      'Vary',
      vary ? `${String(vary)}, Accept-Encoding` : 'Accept-Encoding'
    );
  }

  if (encoding) {
    res.setHeader('Content-Encoding', encoding);
    res.removeHeader('content-length');
  }

  if (!response.body) {
    res.end();

    return;
  }

  try {
    // the html of the router is generated in one pass, so buffering it costs
    // nothing next to the round trip and lets the compressed length travel with
    // the response instead of a chunked stream
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];

    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;

      chunks.push(value);
    }

    const body = Buffer.concat(chunks);
    const output =
      encoding === 'br'
        ? zlib.brotliCompressSync(body, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 }
          })
        : encoding === 'gzip'
          ? zlib.gzipSync(body, { level: 6 })
          : body;

    if (encoding) {
      res.setHeader('Content-Length', output.length);
    }

    if (output.length > 0) {
      res.write(output);
    }

    res.end();
  } catch (error) {
    if (!res.destroyed && !res.writableEnded) {
      logger.error(
        'HTTP response stream error: %s',
        error instanceof Error ? error.message : String(error)
      );
      res.destroy();
    }
  }
};

export { sendWebResponse, toWebRequest };
