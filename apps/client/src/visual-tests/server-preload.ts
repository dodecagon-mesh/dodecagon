const releaseVersion = '0.0.59';
const releaseApi =
  'https://api.github.com/repos/dodecagon-mesh/dodecagon/releases/latest';
const releaseMetadataUrl = `https://github.com/dodecagon-mesh/dodecagon/releases/download/v${releaseVersion}/release.json`;
const nativeFetch = globalThis.fetch;

// Keep the real update route and metadata parser without depending on GitHub.
const visualFetch = ((input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === releaseApi) {
    return Promise.resolve(
      Response.json({
        tag_name: `v${releaseVersion}`,
        assets: [
          {
            name: 'release.json',
            browser_download_url: releaseMetadataUrl,
            url: releaseMetadataUrl
          }
        ]
      })
    );
  }
  if (url === releaseMetadataUrl) {
    return Promise.resolve(
      Response.json({
        version: releaseVersion,
        releaseDate: '2026-10-09T00:00:00Z',
        artifacts: []
      })
    );
  }

  return nativeFetch(input, init);
}) as typeof fetch;

globalThis.fetch = Object.assign(visualFetch, nativeFetch);
