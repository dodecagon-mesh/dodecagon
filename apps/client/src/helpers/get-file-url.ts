import type { TFile } from '@dodecagon/shared';

const getDevelopmentServerPort = () => VITE_SERVER_PORT;

const getHostFromServer = () => {
  if (import.meta.env.MODE === 'development') {
    return `localhost:${getDevelopmentServerPort()}`;
  }

  // the server renders without a window, the browser resolves the relative
  // paths of the page against its own origin
  if (typeof window === 'undefined') {
    return '';
  }

  return window.location.host;
};

const getUrlFromServer = () => {
  if (import.meta.env.MODE === 'development') {
    return `http://localhost:${getDevelopmentServerPort()}`;
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const host = window.location.host;
  const currentProtocol = window.location.protocol;

  const finalUrl = `${currentProtocol}//${host}`;

  return finalUrl;
};

const getFileUrl = (file: TFile | undefined | null) => {
  if (!file) return '';

  const url = getUrlFromServer();
  const params: string[] = [];

  // the hash lets the server and the browser keep the bytes forever, the name
  // alone is reused after a delete
  if (file.md5) {
    params.push(`v=${encodeURIComponent(file.md5)}`);
  }

  if (file._accessToken) {
    params.push(`accessToken=${file._accessToken}`);

    if (file._accessTokenExpiresAt) {
      params.push(`expires=${file._accessTokenExpiresAt}`);
    }
  }

  const baseUrl = `${url}/public/${encodeURIComponent(file.name)}`;

  if (params.length === 0) {
    return baseUrl;
  }

  return `${baseUrl}?${params.join('&')}`;
};

export { getFileUrl, getHostFromServer, getUrlFromServer };
