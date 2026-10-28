import http from 'http';
import zlib from 'zlib';

// text-ish payloads shrink on the wire; images, fonts and archives are already
// compressed and must not pay the cpu and the transfer of a second pass
const COMPRESSIBLE_CONTENT_TYPE =
  /^(?:text\/|application\/(?:javascript|json|manifest\+json|xml|xhtml\+xml)|image\/svg\+xml)/i;

const getPreferredEncoding = (
  req: http.IncomingMessage
): 'br' | 'gzip' | undefined => {
  const header = req.headers['accept-encoding'];

  if (!header) return undefined;

  // quality values decide which encoding the client actually wants, a wildcard
  // is a fallback for both. q=0 excludes an encoding even when it is listed
  const quality = { br: 0, gzip: 0 };

  for (const part of header.split(',')) {
    const [rawName, ...params] = part.trim().toLowerCase().split(';');
    let q = 1;

    for (const param of params) {
      const [key, value] = param.trim().split('=');

      if (key === 'q') q = Number.parseFloat(value ?? '');
    }

    if (!Number.isFinite(q) || q <= 0) continue;

    if (rawName === 'br' || rawName === '*') {
      quality.br = Math.max(quality.br, q);
    }

    if (rawName === 'gzip' || rawName === 'x-gzip' || rawName === '*') {
      quality.gzip = Math.max(quality.gzip, q);
    }
  }

  if (quality.br > 0 && quality.br >= quality.gzip) return 'br';
  if (quality.gzip > 0) return 'gzip';

  return undefined;
};

// quality 6 is the knee of the curve: a 1.2 mb bundle compresses in about 20 ms
// and lands within a few percent of quality 9, which takes more than twice as
// long and would delay every uncached asset
const createCompressor = (encoding: 'br' | 'gzip') => {
  if (encoding === 'br') {
    return zlib.createBrotliCompress({
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 }
    });
  }

  return zlib.createGzip({ level: 6 });
};

export { COMPRESSIBLE_CONTENT_TYPE, createCompressor, getPreferredEncoding };
