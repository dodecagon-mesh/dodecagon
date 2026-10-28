import { expect, spyOn, test } from 'bun:test';
import { config } from '../../config';
import { UpdateRefusedError, updater } from '../updater';

const assetRoot =
  'https://github.com/dodecagon-mesh/dodecagon/releases/download/v0.0.34/';

const release = (version: string, assets = false) =>
  new Response(
    JSON.stringify({
      tag_name: `v${version}`,
      assets: assets
        ? [
            {
              name: 'release.json',
              browser_download_url: assetRoot + 'release.json'
            },
            {
              name: 'dodecagon-linux-x64',
              browser_download_url: assetRoot + 'dodecagon-linux-x64'
            }
          ]
        : []
    })
  );

const metadata = (version: string) =>
  new Response(
    JSON.stringify({
      version,
      releaseDate: '2026-10-15T00:00:00Z',
      artifacts: [
        {
          name: 'dodecagon-linux-x64',
          target: `${process.platform}-${process.arch}`,
          size: 1,
          checksum: 'a'.repeat(64)
        }
      ]
    })
  );

const spyOnTransport = (
  handler: (url: string) => Response | Promise<Response>
) =>
  spyOn(globalThis, 'fetch').mockImplementation((async (
    input: Parameters<typeof fetch>[0]
  ) => handler(String(input))) as typeof fetch);

test('asks the release api for the tag of the requested version', async () => {
  spyOn(updater, 'canUpdate').mockReturnValue(true);
  const urls: string[] = [];
  spyOnTransport((url) => {
    urls.push(url);

    return release('9.9.9');
  });

  // no release.json in the answer, so the install stops before it touches the binary
  await expect(updater.update({ targetVersion: '9.9.9' })).rejects.toThrow(
    'GitHub release is missing release.json'
  );

  expect(urls).toEqual([
    `${config.endpoints.updateReleaseApi.replace(/\/latest$/, '')}/tags/v9.9.9`
  ]);
});

test('asks the release api for the latest release without a target', async () => {
  spyOn(updater, 'canUpdate').mockReturnValue(true);
  const urls: string[] = [];
  spyOnTransport((url) => {
    urls.push(url);

    return release('9.9.9');
  });

  await expect(updater.update()).rejects.toThrow(
    'GitHub release is missing release.json'
  );

  expect(urls).toEqual([config.endpoints.updateReleaseApi]);
});

test('a requested version that is not a release never reaches the network', async () => {
  spyOn(updater, 'canUpdate').mockReturnValue(true);
  const transport = spyOnTransport(() => release('9.9.9'));

  const refusal = updater.update({ targetVersion: '9.9' });

  await expect(refusal).rejects.toBeInstanceOf(UpdateRefusedError);
  await expect(refusal).rejects.toMatchObject({ reason: 'release' });
  expect(transport).not.toHaveBeenCalled();
});

test('an older release replaces the running one only when the caller confirms it', async () => {
  // the test build reports 0.0.0-dev, so a prerelease of 0.0.0 is older than it
  const olderVersion = '0.0.0-0';
  spyOn(updater, 'canUpdate').mockReturnValue(true);
  spyOnTransport((url) =>
    url.endsWith('release.json')
      ? metadata(olderVersion)
      : release(olderVersion, true)
  );

  const refusal = updater.update({ targetVersion: olderVersion });

  await expect(refusal).rejects.toBeInstanceOf(UpdateRefusedError);
  await expect(refusal).rejects.toMatchObject({ reason: 'downgrade' });
});

test('a confirmed downgrade passes the version rule and fails later', async () => {
  const olderVersion = '0.0.0-0';
  spyOn(updater, 'canUpdate').mockReturnValue(true);
  spyOnTransport((url) =>
    url.endsWith('release.json')
      ? metadata(olderVersion)
      : release(olderVersion, true)
  );

  // the fixture has no usable binary behind the artifact, so the install fails on the
  // download: the point is that it is not refused for being older
  const failure = await updater
    .update({ targetVersion: olderVersion, allowDowngrade: true })
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(UpdateRefusedError);
});

test('a release that answers with another version is refused before the download', async () => {
  spyOn(updater, 'canUpdate').mockReturnValue(true);
  spyOnTransport((url) =>
    url.endsWith('release.json') ? metadata('8.8.8') : release('8.8.8', true)
  );

  const refusal = updater.update({ targetVersion: '9.9.9' });

  await expect(refusal).rejects.toBeInstanceOf(UpdateRefusedError);
  await expect(refusal).rejects.toMatchObject({ reason: 'release' });
});
