import {
  getErrorMessage,
  ServerEvents,
  type TServerUpdateState
} from '@dodecagon/shared';
import { BunUpdater, validateReleaseMetadata } from 'bun-sfe-autoupdater';
import { renameSync, rmdirSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import semver from 'semver';
import { setImmediate } from 'timers/promises';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../logger';
import { initVoiceRuntimes } from '../runtimes';
import { VoiceRuntime } from '../runtimes/voice';
import {
  IS_DOCKER,
  IS_PRODUCTION,
  IS_TEST,
  SERVER_VERSION
} from '../utils/env';
import { closeMediasoup, loadMediasoup } from '../utils/mediasoup';
import { pubsub } from '../utils/pubsub';
import { readBodyWithLimit } from '../utils/read-body-with-limit';
import { sha256File } from '../utils/sha-256-file';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const CONSECUTIVE_FAILURES_BEFORE_ALARM = 3;
// both come from config, so a blocked release host is a config change. the manual
// BunUpdater below still asks GitHub directly; multi-source is a follow-up
const RELEASE_API = config.endpoints.updateReleaseApi;
const RELEASE_ASSET_ROOT = new URL(config.endpoints.updateAssetRoot);
const MAX_BINARY_BYTES = 512 * 1024 * 1024;

/**
 * What a manual update asks for. The automatic tick always asks for the latest release
 * and never downgrades, so every field is a decision the caller makes explicitly.
 */
type TUpdateRequest = {
  /** A published version; the latest release when absent. */
  targetVersion?: string;
  /** An older release replaces a newer one only when the caller says so. */
  allowDowngrade?: boolean;
};

/**
 * A refusal the caller is expected to answer for: the update did not run, and the reason
 * is part of the contract rather than a transport failure.
 */
class UpdateRefusedError extends Error {
  public readonly reason:
    'unsupported' | 'in-progress' | 'downgrade' | 'release' | 'installing';

  constructor(reason: UpdateRefusedError['reason'], message: string) {
    super(message);
    this.name = 'UpdateRefusedError';
    this.reason = reason;
  }
}

const zGithubRelease = z.object({
  tag_name: z.string(),
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.url().refine((value) => {
        const url = new URL(value);
        return (
          url.origin === RELEASE_ASSET_ROOT.origin &&
          url.pathname.startsWith(RELEASE_ASSET_ROOT.pathname)
        );
      })
    })
  )
});

const readJson = async (response: Response): Promise<unknown> => {
  const chunks: Uint8Array[] = [];
  await readBodyWithLimit(response, {
    maxBytes: 1024 * 1024,
    tooLargeMessage: 'Update metadata exceeds the size limit',
    onChunk: (chunk) => chunks.push(chunk)
  });
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

class Updater {
  private bunUpdater = new BunUpdater({
    repoOwner: 'dodecagon-mesh',
    repoName: 'dodecagon',
    currentVersion: SERVER_VERSION,
    autoStart: true
  });
  private isUpdating = false;
  private isAutoUpdateStarted = false;
  private consecutiveFailures = 0;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private checkAbort?: AbortController;
  private updateState: TServerUpdateState = null;

  public getUpdateState = (): TServerUpdateState => this.updateState;

  private setUpdateState = (state: TServerUpdateState): void => {
    this.updateState = state;
    pubsub.publish(ServerEvents.SERVER_UPDATE_STATE, state);
  };

  public canUpdate = (): boolean =>
    IS_PRODUCTION &&
    !IS_TEST &&
    !IS_DOCKER &&
    process.platform !== 'win32' &&
    typeof process.execve === 'function';
  public getLatestVersion = async () => this.bunUpdater.getLatestVersion();
  public hasUpdates = async () => this.bunUpdater.hasUpdates();
  public update = async (
    request: TUpdateRequest = {}
  ): Promise<{ updated: boolean }> => ({
    updated: await this.runUpdate(false, request)
  });

  private runUpdate = async (
    automatic: boolean,
    request: TUpdateRequest = {}
  ): Promise<boolean> => {
    if (!this.canUpdate()) {
      if (automatic) return false;
      throw new UpdateRefusedError(
        'unsupported',
        'Binary updates are not supported on this server.'
      );
    }
    if (this.isUpdating) {
      if (automatic) return false;
      throw new UpdateRefusedError(
        'in-progress',
        'A server update is already in progress. Please wait.'
      );
    }
    if (automatic && this.shouldDeferAutoUpdate()) return false;
    this.isUpdating = true;
    this.checkAbort = automatic ? new AbortController() : undefined;
    if (automatic && this.updateState?.phase === 'failed')
      this.setUpdateState(null);
    const previousState = this.updateState;
    if (!automatic) this.setUpdateState({ phase: 'checking' });
    try {
      const updated = await this.installUpdate(automatic, request);
      if (!updated && this.updateState !== previousState)
        this.setUpdateState(null);
      this.consecutiveFailures = 0;
      return updated;
    } catch (error) {
      if (automatic && this.checkAbort?.signal.aborted) {
        if (this.updateState !== previousState) this.setUpdateState(null);
        return false;
      }
      if (this.updateState !== previousState) {
        this.setUpdateState({
          phase: 'failed',
          ...(this.updateState?.targetVersion
            ? { targetVersion: this.updateState.targetVersion }
            : {})
        });
      }
      if (!automatic) {
        logger.error('Failed to update server: %s', getErrorMessage(error));
        throw error;
      }
      this.consecutiveFailures += 1;
      logger.error(
        'Failed to check for updates (%d consecutive): %s',
        this.consecutiveFailures,
        getErrorMessage(error)
      );
      if (this.consecutiveFailures === CONSECUTIVE_FAILURES_BEFORE_ALARM) {
        logger.error(
          'Auto-update has failed %d times in a row. Check GitHub access or disable server.autoupdate.',
          this.consecutiveFailures
        );
      }
      return false;
    } finally {
      this.checkAbort = undefined;
      this.isUpdating = false;
    }
  };

  private fetchUpdate = async (
    url: string,
    timeout = 15_000
  ): Promise<Response> => {
    const response = await fetch(url, {
      signal: this.checkAbort
        ? AbortSignal.any([
            this.checkAbort.signal,
            AbortSignal.timeout(timeout)
          ])
        : AbortSignal.timeout(timeout)
    });
    if (!response.ok)
      throw new Error(`Update download failed: HTTP ${response.status}`);
    return response;
  };

  // the latest release and a named one live under the same api, only the last path
  // segment differs. a target is validated before it reaches the url
  private releaseApiUrl = (targetVersion?: string): string => {
    if (!targetVersion) return RELEASE_API;

    if (!semver.valid(targetVersion)) {
      throw new UpdateRefusedError(
        'release',
        'The requested version is not a valid release version.'
      );
    }

    const url = new URL(RELEASE_API);
    url.pathname = url.pathname.replace(
      /\/latest$/,
      `/tags/v${semver.valid(targetVersion)}`
    );

    return url.toString();
  };

  private installUpdate = async (
    automatic: boolean,
    request: TUpdateRequest = {}
  ): Promise<boolean> => {
    const release = zGithubRelease.parse(
      await readJson(
        await this.fetchUpdate(this.releaseApiUrl(request.targetVersion))
      )
    );
    const manifest = release.assets.find(({ name }) => name === 'release.json');
    if (!manifest) throw new Error('GitHub release is missing release.json');
    const metadata = validateReleaseMetadata(
      await readJson(await this.fetchUpdate(manifest.browser_download_url))
    );
    if (
      !semver.valid(metadata.version) ||
      !semver.valid(release.tag_name) ||
      !semver.eq(metadata.version, release.tag_name)
    ) {
      throw new Error('Release tag and metadata version do not match');
    }
    if (
      request.targetVersion &&
      !semver.eq(metadata.version, request.targetVersion)
    ) {
      throw new UpdateRefusedError(
        'release',
        'The release of the requested version answers with another version.'
      );
    }
    if (semver.eq(metadata.version, SERVER_VERSION)) return false;
    // an older release replaces the running one only when the caller asks for it: the
    // automatic tick never goes back, and a manual call has to say what it means
    if (semver.lt(metadata.version, SERVER_VERSION)) {
      if (automatic) return false;
      if (!request.allowDowngrade) {
        throw new UpdateRefusedError(
          'downgrade',
          'Replacing the running version with an older one needs an explicit confirmation.'
        );
      }
    }
    if (automatic && this.shouldDeferAutoUpdate()) return false;
    if (automatic)
      this.setUpdateState({
        phase: 'checking',
        targetVersion: metadata.version
      });
    const artifact = metadata.artifacts.find(
      ({ target }) => target === `${process.platform}-${process.arch}`
    );
    const asset = release.assets.find(({ name }) => name === artifact?.name);
    if (
      !artifact ||
      !asset ||
      !Number.isSafeInteger(artifact.size) ||
      artifact.size <= 0 ||
      artifact.size > MAX_BINARY_BYTES ||
      !/^[a-f0-9]{64}$/i.test(artifact.checksum)
    ) {
      throw new Error('Release has no valid artifact for this platform');
    }
    this.setUpdateState({
      phase: 'downloading',
      targetVersion: metadata.version
    });
    const binary = process.execPath;
    const directory = await fs.mkdtemp(
      path.join(path.dirname(binary), '.dodecagon-update-')
    );
    const staged = path.join(directory, 'binary');
    const backup = binary + '.old';
    let locked = false;
    let workerStopped = false;
    let installed = false;
    try {
      const response = await this.fetchUpdate(
        asset.browser_download_url,
        300_000
      );
      const writer = Bun.file(staged).writer();
      try {
        await readBodyWithLimit(response, {
          maxBytes: artifact.size,
          tooLargeMessage: 'Update binary exceeds the declared size',
          onChunk: (chunk) => writer.write(chunk)
        });
      } finally {
        await writer.end();
      }
      if (
        (await fs.stat(staged)).size !== artifact.size ||
        (await sha256File(staged)) !== artifact.checksum.toLowerCase()
      ) {
        throw new Error('Update binary size or SHA-256 does not match');
      }
      await fs.chmod(staged, (await fs.stat(binary)).mode & 0o777);
      await fs.copyFile(binary, backup);
      if (automatic && this.shouldDeferAutoUpdate()) return false;
      if (!VoiceRuntime.beginIdleUpdate(!automatic)) {
        if (automatic) return false;
        throw new UpdateRefusedError(
          'installing',
          'The server is already installing an update. Please wait.'
        );
      }
      locked = true;
      this.setUpdateState({
        phase: 'installing',
        targetVersion: metadata.version
      });
      workerStopped = await closeMediasoup();
      if (automatic && this.shouldDeferAutoUpdate()) return false;
      this.setUpdateState({
        phase: 'restarting',
        targetVersion: metadata.version
      });
      // Let subscribed sockets flush the restart notice before replacing this process.
      await setImmediate();
      if (automatic && this.shouldDeferAutoUpdate()) return false;
      // No await between atomic replacement and exec: new voice joins remain blocked.
      renameSync(staged, binary);
      installed = true;
      try {
        rmdirSync(directory);
        process.execve!(
          binary,
          [binary, ...process.argv.slice(2)],
          process.env
        );
      } catch (error) {
        renameSync(backup, binary);
        installed = false;
        throw error;
      }
      return true;
    } finally {
      try {
        if (workerStopped && !installed) {
          // worker shutdown ended these calls even though the binary rolled back.
          // publish departures so clients clear their sessions before rejoining.
          for (const channelId of Object.keys(VoiceRuntime.getVoiceMap())) {
            const runtime = VoiceRuntime.findById(Number(channelId));
            await runtime?.destroy();
          }
          await loadMediasoup();
          await initVoiceRuntimes();
        }
      } finally {
        if (locked) VoiceRuntime.endIdleUpdate();
        await fs.rm(directory, { recursive: true, force: true });
      }
    }
  };

  private shouldDeferAutoUpdate = (): boolean =>
    !this.isAutoUpdateStarted ||
    !config.server.autoupdate ||
    !!this.checkAbort?.signal.aborted ||
    Object.values(VoiceRuntime.getVoiceMap()).some(
      ({ users }) => Object.keys(users).length > 0
    );

  public start = (): void => {
    if (!this.canUpdate() || !config.server.autoupdate || this.checkTimer)
      return;
    this.isAutoUpdateStarted = true;
    this.checkTimer = setInterval(
      this.updateAutomatically,
      UPDATE_CHECK_INTERVAL_MS
    );
    this.checkTimer.unref();
    this.updateAutomatically();
  };

  public stop = (): void => {
    this.isAutoUpdateStarted = false;
    this.checkAbort?.abort();
    if (!this.checkTimer) return;
    clearInterval(this.checkTimer);
    this.checkTimer = null;
  };

  private updateAutomatically = (): Promise<boolean> | undefined => {
    if (
      !this.isAutoUpdateStarted ||
      !this.canUpdate() ||
      this.shouldDeferAutoUpdate()
    )
      return;
    return this.runUpdate(true);
  };
}

const updater = new Updater();
export { updater, UpdateRefusedError, type TUpdateRequest };
