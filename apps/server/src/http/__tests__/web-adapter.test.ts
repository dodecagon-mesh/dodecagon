import { describe, expect, test } from 'bun:test';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import zlib from 'node:zlib';
import { sendWebResponse, toWebRequest } from '../web-adapter';

const createRequest = (url: string, method = 'GET', body?: string) => {
  const req = new IncomingMessage(new Socket());

  req.url = url;
  req.method = method;
  req.headers = { 'x-token': 'secret' };

  if (body !== undefined) {
    req.push(body);
    req.push(null);
  }

  return req;
};

describe('the web adapter', () => {
  test('builds a request with the method, the url and the headers', () => {
    const request = toWebRequest(
      createRequest('/info'),
      new URL('http://localhost/info')
    );

    expect(request.method).toBe('GET');
    expect(request.url).toBe('http://localhost/info');
    expect(request.headers.get('x-token')).toBe('secret');
  });

  test('carries the request body over to the web request', async () => {
    const request = toWebRequest(
      createRequest('/login', 'POST', '{"identity":"demo"}'),
      new URL('http://localhost/login')
    );

    expect(request.method).toBe('POST');
    expect(await request.text()).toBe('{"identity":"demo"}');
  });

  test('writes the status, the headers and the body into the response', async () => {
    const res = new ServerResponse(createRequest('/info'));

    const chunks: Buffer[] = [];

    res.write = ((chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));

      return true;
    }) as typeof res.write;

    await sendWebResponse(
      res,
      Response.json({ status: 'ok' }, { status: 201 })
    );

    expect(res.statusCode).toBe(201);
    expect(res.getHeader('content-type')).toContain('application/json');
    expect(Buffer.concat(chunks).toString()).toBe('{"status":"ok"}');
  });

  test('compresses html and marks it for revalidation', async () => {
    const req = createRequest('/');
    req.headers['accept-encoding'] = 'br';

    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];

    res.write = ((chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));

      return true;
    }) as typeof res.write;

    const html = '<!doctype html><p>hello</p>'.repeat(80);

    await sendWebResponse(
      res,
      new Response(html, { headers: { 'content-type': 'text/html' } })
    );

    expect(res.getHeader('content-encoding')).toBe('br');
    expect(res.getHeader('vary')).toContain('Accept-Encoding');
    expect(res.getHeader('cache-control')).toBe('no-cache');
    expect(zlib.brotliDecompressSync(Buffer.concat(chunks)).toString()).toBe(
      html
    );
  });

  test('leaves a response uncompressed when the client asks for identity', async () => {
    const req = createRequest('/');
    req.headers['accept-encoding'] = 'identity';

    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];

    res.write = ((chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));

      return true;
    }) as typeof res.write;

    await sendWebResponse(
      res,
      new Response('<!doctype html><p>hello</p>', {
        headers: { 'content-type': 'text/html' }
      })
    );

    expect(res.getHeader('content-encoding')).toBeUndefined();
    expect(Buffer.concat(chunks).toString()).toBe(
      '<!doctype html><p>hello</p>'
    );
  });

  test('keeps every cookie of the response apart', async () => {
    const res = new ServerResponse(createRequest('/login'));

    const headers = new Headers();

    headers.append('set-cookie', 'first=1; Path=/');
    headers.append('set-cookie', 'second=2; Path=/');

    await sendWebResponse(res, new Response(null, { status: 302, headers }));

    expect(res.getHeader('set-cookie')).toEqual([
      'first=1; Path=/',
      'second=2; Path=/'
    ]);
  });
});
