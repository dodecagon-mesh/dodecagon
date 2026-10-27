import fs from 'fs';
import http from 'http';
import path from 'path';
import { isPathInside } from '../helpers/is-path-inside';
import { INTERFACE_PATH } from '../helpers/paths';
import { IS_DEVELOPMENT, IS_TEST } from '../utils/env';
import { sendFile, sendJsonError } from './helpers';

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
let manifestAssetCache:
  { interfacePath: string; assets: Set<string> } | undefined;

const getManifestAssets = (): Set<string> => {
  if (manifestAssetCache?.interfacePath === INTERFACE_PATH) {
    return manifestAssetCache.assets;
  }

  const assets = new Set<string>();
  try {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(INTERFACE_PATH, '.vite', 'manifest.json'),
        'utf8'
      )
    ) as Record<string, { file?: unknown; css?: unknown; assets?: unknown }>;
    for (const entry of Object.values(manifest)) {
      for (const value of [
        entry.file,
        ...(Array.isArray(entry.css) ? entry.css : []),
        ...(Array.isArray(entry.assets) ? entry.assets : [])
      ]) {
        if (
          typeof value === 'string' &&
          value.length > 0 &&
          !value.startsWith('/') &&
          !value.split('/').includes('..')
        ) {
          assets.add(value);
        }
      }
    }
  } catch {
    // Retry later if extraction or a test fixture has not supplied the manifest yet.
    return new Set<string>();
  }

  manifestAssetCache = { interfacePath: INTERFACE_PATH, assets };
  return assets;
};

// report-only: the browser logs violations and enforces nothing
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  // the marketplace registry now comes from this server, so no third party host
  // belongs in connect-src
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'"
].join('; ');

const interfaceRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  { url }: { url: URL }
) => {
  if (IS_DEVELOPMENT && !IS_TEST) {
    res.writeHead(302, { Location: `http://localhost:5173${url.search}` });
    res.end();

    return res;
  }

  res.setHeader('Content-Security-Policy-Report-Only', CONTENT_SECURITY_POLICY);

  let subPath = decodeURIComponent(url.pathname);

  subPath = subPath === '/' ? 'index.html' : subPath;

  const cleanSubPath = subPath.startsWith('/') ? subPath.slice(1) : subPath;

  const requestedPath = path.resolve(INTERFACE_PATH, cleanSubPath);

  if (!isPathInside(INTERFACE_PATH, requestedPath)) {
    sendJsonError(res, 403, 'Forbidden');

    return res;
  }

  const isManifestAsset = getManifestAssets().has(cleanSubPath);

  await sendFile(req, res, requestedPath, {
    cacheControl: isManifestAsset ? IMMUTABLE_CACHE_CONTROL : 'no-cache'
  });

  return res;
};

export { interfaceRouteHandler };
