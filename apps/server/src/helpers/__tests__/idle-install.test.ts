import { expect, mock, spyOn, test } from 'bun:test';
import { EventEmitter } from 'events';
import { readdirSync } from 'fs';
import fs from 'fs/promises';
import type { Producer } from 'mediasoup/types';
import os from 'os';
import path from 'path';
import { config } from '../../config';
import { logger } from '../../logger';
import { VoiceRuntime } from '../../runtimes/voice';
import * as media from '../../utils/mediasoup';
import { updater } from '../updater';

const releaseRoot =
  'https://github.com/dodecagon-mesh/dodecagon/releases/download/v0.0.35/';
const newBytes = new TextEncoder().encode('verified-new-binary');
const checksum = new Bun.CryptoHasher('sha256').update(newBytes).digest('hex');
const json = (value: unknown) => new Response(JSON.stringify(value));

const setup = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'idle-install-'));
  const binary = path.join(directory, 'dodecagon');
  await fs.writeFile(binary, 'old-running-binary', { mode: 0o755 });
  const previousExecPath = process.execPath;
  const previousAutoupdate = config.server.autoupdate;
  process.execPath = binary;
  config.server.autoupdate = true;
  spyOn(updater, 'canUpdate').mockReturnValue(true);
  let tick = () => {};
  const interval = spyOn(globalThis, 'setInterval').mockImplementation(((
    callback: () => void
  ) => {
    tick = callback;
    return { unref() {} } as ReturnType<typeof setInterval>;
  }) as typeof setInterval);
  spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
  const errors = spyOn(logger, 'error').mockImplementation(() => logger);
  const closeWorker = spyOn(media, 'closeMediasoup').mockResolvedValue(false);
  const execve = spyOn(process, 'execve').mockImplementation(
    () => undefined as never
  );
  const spawn = spyOn(Bun, 'spawn').mockImplementation(() => {
    throw new Error('An external installer must not be spawned');
  });
  const transport = (async (input) => {
    const url = String(input);
    if (
      url ===
      'https://api.github.com/repos/dodecagon-mesh/dodecagon/releases/latest'
    ) {
      return json({
        tag_name: 'v0.0.35',
        assets: [
          {
            name: 'release.json',
            browser_download_url: releaseRoot + 'release.json',
            url: releaseRoot + 'release.json'
          },
          {
            name: 'dodecagon-linux-x64',
            browser_download_url: releaseRoot + 'dodecagon-linux-x64',
            url: releaseRoot + 'dodecagon-linux-x64'
          }
        ]
      });
    }
    if (url === releaseRoot + 'release.json') {
      return json({
        version: '0.0.35',
        releaseDate: '2026-10-15T00:00:00Z',
        artifacts: [
          {
            name: 'dodecagon-linux-x64',
            target: 'linux-x64',
            size: newBytes.length,
            checksum
          }
        ]
      });
    }
    if (url === releaseRoot + 'dodecagon-linux-x64')
      return new Response(newBytes);
    throw new Error('Unexpected download ' + url);
  }) as typeof fetch;
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(transport);
  const settle = async (expectedExec = 1, expectedErrors = 1) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      await Bun.sleep(5);
      if (
        execve.mock.calls.length >= expectedExec ||
        errors.mock.calls.length >= expectedErrors
      )
        return;
    }
  };
  return {
    binary,
    directory,
    execve,
    spawn,
    fetchSpy,
    transport,
    interval,
    closeWorker,
    errors,
    tick: () => tick(),
    settle,
    cleanup: async () => {
      updater.stop();
      await Bun.sleep(10);
      process.execPath = previousExecPath;
      config.server.autoupdate = previousAutoupdate;
      mock.restore();
      await fs.rm(directory, { recursive: true, force: true });
    }
  };
};

test('idle auto-update verifies and atomically installs the app without an external installer', async () => {
  const fixture = await setup();
  try {
    updater.start();
    await fixture.settle();
    expect(fixture.execve).toHaveBeenCalledTimes(1);
    expect(fixture.spawn).not.toHaveBeenCalled();
    expect(await fs.readFile(fixture.binary, 'utf8')).toBe(
      'verified-new-binary'
    );
    expect(await fs.readFile(fixture.binary + '.old', 'utf8')).toBe(
      'old-running-binary'
    );
    expect(fixture.execve.mock.calls[0]?.[0]).toBe(fixture.binary);
    expect(fixture.execve.mock.calls[0]?.[1]).toEqual([
      fixture.binary,
      ...process.argv.slice(2)
    ]);
  } finally {
    await fixture.cleanup();
  }
});

test('hourly checks wait for all voice channels including muted and voice-only members', async () => {
  const fixture = await setup();
  const runtime = new VoiceRuntime(9000701);
  try {
    runtime.addUser(9000701, { micMuted: true, soundMuted: true });
    runtime.updateUserState(9000701, { voiceOnlyMode: true });
    updater.start();
    updater.start();
    expect(fixture.interval).toHaveBeenCalledTimes(1);
    expect(fixture.interval.mock.calls[0]?.[1]).toBe(60 * 60 * 1000);
    expect(fixture.fetchSpy).not.toHaveBeenCalled();
    runtime.removeUser(9000701);
    fixture.tick();
    await fixture.settle();
    expect(fixture.execve).toHaveBeenCalledTimes(1);
  } finally {
    await runtime.destroy();
    await fixture.cleanup();
  }
});

for (const phase of ['release.json', 'dodecagon-linux-x64']) {
  test(`a real voice join during ${phase} defers install without disconnecting the member`, async () => {
    const fixture = await setup();
    const runtime = new VoiceRuntime(9000702);
    try {
      fixture.fetchSpy.mockImplementation((async (input, init) => {
        if (String(input) === releaseRoot + phase)
          runtime.addUser(9000702, { micMuted: false, soundMuted: false });
        return fixture.transport(input, init);
      }) as typeof fetch);
      updater.start();
      await Bun.sleep(80);
      expect(fixture.execve).not.toHaveBeenCalled();
      expect(fixture.closeWorker).not.toHaveBeenCalled();
      expect(runtime.getUser(9000702)).toBeDefined();
      expect(await fs.readFile(fixture.binary, 'utf8')).toBe(
        'old-running-binary'
      );
      expect(
        (await fs.readdir(fixture.directory)).filter((name) =>
          name.startsWith('.dodecagon-update-')
        )
      ).toHaveLength(0);
    } finally {
      await runtime.destroy();
      await fixture.cleanup();
    }
  });
}

test('voice admission is blocked synchronously while waiting for the worker to exit', async () => {
  const fixture = await setup();
  const runtime = new VoiceRuntime(9000703);
  let finish = (_value: boolean) => {};
  const closed = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  try {
    fixture.closeWorker.mockImplementation(() => closed);
    updater.start();
    for (
      let attempt = 0;
      attempt < 100 && !fixture.closeWorker.mock.calls.length;
      attempt++
    )
      await Bun.sleep(5);
    expect(fixture.closeWorker).toHaveBeenCalledTimes(1);
    expect(fixture.execve).not.toHaveBeenCalled();
    expect(() =>
      runtime.addUser(9000703, { micMuted: false, soundMuted: false })
    ).toThrow('The server is installing an update');
    expect(runtime.getUser(9000703)).toBeUndefined();
    finish(false);
    await fixture.settle();
    expect(fixture.execve).toHaveBeenCalledTimes(1);
    runtime.addUser(9000703, { micMuted: false, soundMuted: false });
    expect(runtime.getUser(9000703)).toBeDefined();
  } finally {
    finish(false);
    await runtime.destroy();
    await fixture.cleanup();
  }
});

for (const failure of ['checksum', 'size', 'http']) {
  test(`${failure} failure leaves the running binary and voice worker intact`, async () => {
    const fixture = await setup();
    try {
      fixture.fetchSpy.mockImplementation((async (input, init) => {
        if (String(input) === releaseRoot + 'dodecagon-linux-x64') {
          if (failure === 'http')
            return new Response('failed', { status: 503 });
          return new Response(
            failure === 'size'
              ? newBytes.slice(0, -1)
              : newBytes.map((byte) => byte ^ 1)
          );
        }
        return fixture.transport(input, init);
      }) as typeof fetch);
      updater.start();
      await fixture.settle();
      expect(fixture.errors).toHaveBeenCalled();
      expect(fixture.execve).not.toHaveBeenCalled();
      expect(fixture.closeWorker).not.toHaveBeenCalled();
      expect(await fs.readFile(fixture.binary, 'utf8')).toBe(
        'old-running-binary'
      );
      expect(await fs.readdir(fixture.directory)).toEqual(['dodecagon']);
    } finally {
      await fixture.cleanup();
    }
  });
}

test('the next hourly check retries after a failed download', async () => {
  const fixture = await setup();
  let fail = true;
  try {
    fixture.fetchSpy.mockImplementation((async (input, init) => {
      if (fail && String(input) === releaseRoot + 'dodecagon-linux-x64')
        return new Response('failed', { status: 503 });
      return fixture.transport(input, init);
    }) as typeof fetch);
    updater.start();
    await fixture.settle();
    expect(fixture.execve).not.toHaveBeenCalled();
    fail = false;
    fixture.tick();
    await fixture.settle(1, 2);
    expect(fixture.execve).toHaveBeenCalledTimes(1);
  } finally {
    await fixture.cleanup();
  }
});

test('a failed exec restores the previous binary and releases the voice gate', async () => {
  const fixture = await setup();
  const runtime = new VoiceRuntime(9000704);
  try {
    fixture.execve.mockImplementation(() => {
      throw new Error('exec denied');
    });
    updater.start();
    // Wait for the reported failure, not merely entry into execve.
    await fixture.settle(Infinity);
    expect(fixture.execve).toHaveBeenCalledTimes(1);
    expect(fixture.errors).toHaveBeenCalled();
    expect(await fs.readFile(fixture.binary, 'utf8')).toBe(
      'old-running-binary'
    );
    runtime.addUser(9000704, { micMuted: false, soundMuted: false });
    expect(runtime.getUser(9000704)).toBeDefined();
  } finally {
    await runtime.destroy();
    await fixture.cleanup();
  }
});

test('explicit disabling and development guards do not start a timer', async () => {
  const fixture = await setup();
  try {
    config.server.autoupdate = false;
    updater.start();
    expect(fixture.interval).not.toHaveBeenCalled();
    config.server.autoupdate = true;
    spyOn(updater, 'canUpdate').mockReturnValue(false);
    updater.start();
    expect(fixture.interval).not.toHaveBeenCalled();
    expect(fixture.fetchSpy).not.toHaveBeenCalled();
  } finally {
    await fixture.cleanup();
  }
});

test('stopping during a download prevents replacement', async () => {
  const fixture = await setup();
  try {
    fixture.fetchSpy.mockImplementation((async (input, init) => {
      if (String(input) === releaseRoot + 'dodecagon-linux-x64') updater.stop();
      return fixture.transport(input, init);
    }) as typeof fetch);
    updater.start();
    await Bun.sleep(80);
    expect(fixture.execve).not.toHaveBeenCalled();
    expect(await fs.readFile(fixture.binary, 'utf8')).toBe(
      'old-running-binary'
    );
    expect(fixture.closeWorker).not.toHaveBeenCalled();
  } finally {
    await fixture.cleanup();
  }
});

test('staging cleanup completes before exec replaces the process', async () => {
  const fixture = await setup();
  let directoriesAtExec: string[] = [];
  try {
    fixture.execve.mockImplementation(() => {
      directoriesAtExec = readdirSync(fixture.directory).filter((name) =>
        name.startsWith('.dodecagon-update-')
      );
      return undefined as never;
    });
    updater.start();
    await fixture.settle();
    expect(fixture.execve).toHaveBeenCalledTimes(1);
    expect(directoriesAtExec).toEqual([]);
  } finally {
    await fixture.cleanup();
  }
});

test('plugin radio without listeners does not prevent updates; an actual listener does', async () => {
  const fixture = await setup();
  const runtime = new VoiceRuntime(9000705);
  const observer = new EventEmitter();
  try {
    runtime.createExternalStream({
      title: 'Radio',
      key: 'radio',
      pluginId: 'test-radio',
      producers: {
        audio: {
          id: 'test-radio-producer',
          observer,
          close: () => observer.emit('close')
        } as unknown as Producer
      }
    });
    runtime.addUser(9000705, { micMuted: true, soundMuted: false });
    updater.start();
    expect(fixture.fetchSpy).not.toHaveBeenCalled();
    expect(fixture.execve).not.toHaveBeenCalled();
    runtime.removeUser(9000705);
    expect(runtime.getState().users).toHaveLength(0);
    expect(Object.keys(runtime.getState().externalStreams)).toHaveLength(1);
    fixture.tick();
    await fixture.settle();
    expect(fixture.execve).toHaveBeenCalledTimes(1);
  } finally {
    await runtime.destroy();
    await fixture.cleanup();
  }
});

test('version queries still use the documented updater API', async () => {
  const fixture = await setup();
  try {
    expect(await updater.getLatestVersion()).toBe('0.0.35');
    expect(await updater.hasUpdates()).toBe(true);
    expect(fixture.execve).not.toHaveBeenCalled();
  } finally {
    await fixture.cleanup();
  }
});

test('release asset URLs cannot escape the fork download path through dot segments', async () => {
  const fixture = await setup();
  try {
    fixture.fetchSpy.mockImplementation((async (
      _input: Parameters<typeof fetch>[0]
    ) =>
      json({
        tag_name: 'v0.0.35',
        assets: [
          {
            name: 'release.json',
            browser_download_url:
              releaseRoot + '../../../../elsewhere/release.json'
          }
        ]
      })) as typeof fetch);
    updater.start();
    await fixture.settle();
    expect(fixture.fetchSpy).toHaveBeenCalledTimes(1);
    expect(fixture.execve).not.toHaveBeenCalled();
  } finally {
    await fixture.cleanup();
  }
});
