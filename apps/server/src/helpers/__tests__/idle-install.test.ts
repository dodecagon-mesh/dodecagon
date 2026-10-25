import { ServerEvents, type TServerUpdateState } from '@dodecagon/shared';
import { expect, mock, spyOn, test } from 'bun:test';
import { EventEmitter } from 'events';
import { readdirSync } from 'fs';
import fs from 'fs/promises';
import type { Producer } from 'mediasoup/types';
import os from 'os';
import path from 'path';
import { getCaller, initTest } from '../../__tests__/helpers';
import { getTestVoiceConnection } from '../../__tests__/voice-connection';
import { config } from '../../config';
import { logger } from '../../logger';
import { VoiceRuntime } from '../../runtimes/voice';
import { SERVER_VERSION } from '../../utils/env';
import * as media from '../../utils/mediasoup';
import { pubsub } from '../../utils/pubsub';
import { updater } from '../updater';

const releaseRoot =
  'https://github.com/dodecagon-mesh/dodecagon/releases/download/v0.0.35/';
const newBytes = new TextEncoder().encode('verified-new-binary');
const checksum = new Bun.CryptoHasher('sha256').update(newBytes).digest('hex');
const json = (value: unknown) => new Response(JSON.stringify(value));

const setup = async (version = '0.0.35') => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'idle-install-'));
  const binary = path.join(directory, 'dodecagon');
  await fs.writeFile(binary, 'old-running-binary', { mode: 0o755 });
  const previousExecPath = process.execPath;
  const previousAutoupdate = config.server.autoupdate;
  process.execPath = binary;
  config.server.autoupdate = true;
  spyOn(updater, 'canUpdate').mockReturnValue(true);
  let tick: () => void | Promise<boolean> = () => {};
  const interval = spyOn(globalThis, 'setInterval').mockImplementation(((
    callback: () => void | Promise<boolean>
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
        tag_name: `v${version}`,
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
        version,
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
    runtime.addUser(
      9000701,
      { micMuted: true, soundMuted: true },
      getTestVoiceConnection(9000701)
    );
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
          runtime.addUser(
            9000702,
            { micMuted: false, soundMuted: false },
            getTestVoiceConnection(9000702)
          );
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
      runtime.addUser(
        9000703,
        { micMuted: false, soundMuted: false },
        getTestVoiceConnection(9000703)
      )
    ).toThrow('The server is installing an update');
    expect(runtime.getUser(9000703)).toBeUndefined();
    finish(false);
    await fixture.settle();
    expect(fixture.execve).toHaveBeenCalledTimes(1);
    runtime.addUser(
      9000703,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(9000703)
    );
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
    runtime.addUser(
      9000704,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(9000704)
    );
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
    runtime.addUser(
      9000705,
      { micMuted: true, soundMuted: false },
      getTestVoiceConnection(9000705)
    );
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

test('explicit update installs latest during calls with autoupdate disabled', async () => {
  const fixture = await setup();
  const runtime = new VoiceRuntime(9000706);
  try {
    config.server.autoupdate = false;
    runtime.addUser(
      9000706,
      { micMuted: true, soundMuted: true },
      getTestVoiceConnection(9000706)
    );
    fixture.closeWorker.mockImplementation(async () => {
      expect(() =>
        runtime.addUser(
          9000707,
          { micMuted: false, soundMuted: false },
          getTestVoiceConnection(9000707)
        )
      ).toThrow('The server is installing an update');
      // Disabling scheduled checks must not cancel an explicit update.
      updater.stop();
      return false;
    });
    await updater.update();
    expect(await fs.readFile(fixture.binary, 'utf8')).toBe(
      'verified-new-binary'
    );
    expect(await fs.readFile(fixture.binary + '.old', 'utf8')).toBe(
      'old-running-binary'
    );
    expect(fixture.execve).toHaveBeenCalledTimes(1);
    expect(fixture.spawn).not.toHaveBeenCalled();
  } finally {
    await runtime.destroy();
    await fixture.cleanup();
  }
});

test('explicit update rejects unsupported environments before any download', async () => {
  const fixture = await setup();
  try {
    spyOn(updater, 'canUpdate').mockReturnValue(false);
    await expect(updater.update()).rejects.toThrow('not supported');
    expect(fixture.fetchSpy).not.toHaveBeenCalled();
    expect(fixture.execve).not.toHaveBeenCalled();
    expect(await fs.readFile(fixture.binary, 'utf8')).toBe(
      'old-running-binary'
    );
  } finally {
    await fixture.cleanup();
  }
});

test('explicit updates reject concurrent requests instead of reporting success', async () => {
  const fixture = await setup();
  const { promise: blocked, resolve: release } = Promise.withResolvers<void>();
  fixture.fetchSpy.mockImplementation((async (input, init) => {
    await blocked;
    return fixture.transport(input, init);
  }) as typeof fetch);
  const first = updater.update();
  try {
    await expect(updater.update()).rejects.toThrow('already in progress');
  } finally {
    release();
    try {
      await first;
    } finally {
      await fixture.cleanup();
    }
  }
});

for (const failure of ['checksum', 'size', 'http', 'platform', 'metadata']) {
  test(`explicit ${failure} failure rejects and leaves the running binary intact`, async () => {
    const fixture = await setup();
    try {
      fixture.fetchSpy.mockImplementation((async (input, init) => {
        const url = String(input);
        if (url === releaseRoot + 'release.json') {
          const response = await fixture.transport(input, init);
          const metadata = (await response.json()) as Record<string, unknown>;
          if (failure === 'platform') metadata.artifacts = [];
          if (failure === 'metadata') metadata.version = '0.0.36';
          return json(metadata);
        }
        if (url === releaseRoot + 'dodecagon-linux-x64') {
          if (failure === 'http')
            return new Response('failed', { status: 503 });
          if (failure === 'size') return new Response(newBytes.slice(0, -1));
          if (failure === 'checksum')
            return new Response(newBytes.map((byte) => byte ^ 1));
        }
        return fixture.transport(input, init);
      }) as typeof fetch);
      await expect(updater.update()).rejects.toThrow();
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

test('failed explicit restart announces departures and rebuilds registered voice runtimes that users can rejoin', async () => {
  const fixture = await setup();
  const channelId = 2;
  const userId = 1;
  const runtime = new VoiceRuntime(channelId);
  const departures: { channelId: number; userId: number; sessionId: string }[] =
    [];
  const subscription = pubsub
    .subscribe(ServerEvents.USER_LEAVE_VOICE)
    .subscribe({
      next: (event) => departures.push(event)
    });
  try {
    await runtime.init();
    const sessionId = crypto.randomUUID();
    runtime.addUser(
      userId,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(userId),
      sessionId
    );
    const { caller } = await initTest(userId, undefined, {
      currentVoiceChannelId: channelId
    });
    fixture.closeWorker.mockResolvedValue(true);
    // Keep the test worker alive, but exercise real runtime teardown/recreation.
    spyOn(media, 'loadMediasoup').mockResolvedValue(undefined);
    fixture.execve.mockImplementation(() => {
      throw new Error('exec denied');
    });
    await expect(updater.update()).rejects.toThrow('exec denied');
    expect(await fs.readFile(fixture.binary, 'utf8')).toBe(
      'old-running-binary'
    );
    const restored = VoiceRuntime.findById(channelId);
    expect(restored).toBeDefined();
    expect(restored).not.toBe(runtime);
    expect(restored?.getState().users).toEqual([]);
    expect(runtime.getState().users).toEqual([]);
    expect(departures).toContainEqual({ channelId, userId, sessionId });

    // USER_LEAVE_VOICE is the client's authoritative own-session cleanup event.
    // The still-connected caller must be able to join the replacement and leave it.
    await caller.voice.join({
      channelId,
      state: { micMuted: false, soundMuted: false }
    });
    expect(VoiceRuntime.findRuntimeByUserId(userId)).toBe(restored);
    await caller.voice.leave();
    expect(restored?.getUser(userId)).toBeUndefined();
  } finally {
    subscription.unsubscribe();
    for (const id of Object.keys(VoiceRuntime.getVoiceMap())) {
      await VoiceRuntime.findById(Number(id))?.destroy();
    }
    await fixture.cleanup();
  }
});

for (const version of [SERVER_VERSION, '0.0.0-0']) {
  test(`explicit update will not replace current ${SERVER_VERSION} with ${version}`, async () => {
    const fixture = await setup(version);
    try {
      await expect(updater.update()).resolves.toEqual({ updated: false });
      expect(fixture.fetchSpy).toHaveBeenCalledTimes(2);
      expect(fixture.execve).not.toHaveBeenCalled();
      expect(fixture.closeWorker).not.toHaveBeenCalled();
      expect(await fs.readFile(fixture.binary, 'utf8')).toBe(
        'old-running-binary'
      );
    } finally {
      await fixture.cleanup();
    }
  });
}

test('explicit lifecycle exposes real install phases and the validated target to all subscribers', async () => {
  const fixture = await setup();
  const states: TServerUpdateState[] = [];
  const subscription = pubsub
    .subscribe(ServerEvents.SERVER_UPDATE_STATE)
    .subscribe({ next: (state) => states.push(state) });
  try {
    fixture.closeWorker.mockImplementation(async () => {
      expect(states.at(-1)).toEqual({
        phase: 'installing',
        targetVersion: '0.0.35'
      });
      return false;
    });
    fixture.execve.mockImplementation(() => {
      expect(states.at(-1)).toEqual({
        phase: 'restarting',
        targetVersion: '0.0.35'
      });
      return undefined as never;
    });
    await updater.update();
    expect(states).toEqual([
      { phase: 'checking' },
      { phase: 'downloading', targetVersion: '0.0.35' },
      { phase: 'installing', targetVersion: '0.0.35' },
      { phase: 'restarting', targetVersion: '0.0.35' }
    ]);
  } finally {
    subscription.unsubscribe();
    await fixture.cleanup();
  }
});

test('automatic idle deferral never announces an update and a later idle attempt does', async () => {
  const fixture = await setup();
  const runtime = new VoiceRuntime(9000708);
  const states: TServerUpdateState[] = [];
  const subscription = pubsub
    .subscribe(ServerEvents.SERVER_UPDATE_STATE)
    .subscribe({ next: (state) => states.push(state) });
  try {
    runtime.addUser(
      9000708,
      { micMuted: true, soundMuted: true },
      getTestVoiceConnection(9000708)
    );
    updater.start();
    expect(states).toEqual([]);
    runtime.removeUser(9000708);
    await fixture.tick();
    expect(states).toEqual([
      { phase: 'checking', targetVersion: '0.0.35' },
      { phase: 'downloading', targetVersion: '0.0.35' },
      { phase: 'installing', targetVersion: '0.0.35' },
      { phase: 'restarting', targetVersion: '0.0.35' }
    ]);
  } finally {
    subscription.unsubscribe();
    await runtime.destroy();
    await fixture.cleanup();
  }
});

test('a voice join while automatic metadata is checked does not announce an update', async () => {
  const fixture = await setup();
  const runtime = new VoiceRuntime(9000709);
  const states: TServerUpdateState[] = [];
  const subscription = pubsub
    .subscribe(ServerEvents.SERVER_UPDATE_STATE)
    .subscribe({ next: (state) => states.push(state) });
  try {
    runtime.addUser(
      9000709,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(9000709)
    );
    updater.start();
    runtime.removeUser(9000709);
    fixture.fetchSpy.mockImplementation((async (input, init) => {
      if (String(input) === releaseRoot + 'release.json') {
        runtime.addUser(
          9000709,
          { micMuted: false, soundMuted: false },
          getTestVoiceConnection(9000709)
        );
      }
      return fixture.transport(input, init);
    }) as typeof fetch);
    await fixture.tick();
    expect(states).toEqual([]);
  } finally {
    subscription.unsubscribe();
    await runtime.destroy();
    await fixture.cleanup();
  }
});

test('current-version explicit checks clear lifecycle without announcing a restart', async () => {
  const fixture = await setup(SERVER_VERSION);
  const states: TServerUpdateState[] = [];
  const subscription = pubsub
    .subscribe(ServerEvents.SERVER_UPDATE_STATE)
    .subscribe({ next: (state) => states.push(state) });
  try {
    await expect(updater.update()).resolves.toEqual({ updated: false });
    expect(states).toEqual([{ phase: 'checking' }, null]);
    expect(updater.getUpdateState()).toBeNull();
  } finally {
    subscription.unsubscribe();
    await fixture.cleanup();
  }
});

test('stopping an announced automatic download clears updating without a failure', async () => {
  const fixture = await setup();
  const runtime = new VoiceRuntime(9000710);
  const states: TServerUpdateState[] = [];
  const subscription = pubsub
    .subscribe(ServerEvents.SERVER_UPDATE_STATE)
    .subscribe({ next: (state) => states.push(state) });
  try {
    runtime.addUser(
      9000710,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(9000710)
    );
    updater.start();
    runtime.removeUser(9000710);
    fixture.fetchSpy.mockImplementation((async (input, init) => {
      if (String(input) === releaseRoot + 'dodecagon-linux-x64') updater.stop();
      return fixture.transport(input, init);
    }) as typeof fetch);
    await fixture.tick();
    expect(states).toEqual([
      { phase: 'checking', targetVersion: '0.0.35' },
      { phase: 'downloading', targetVersion: '0.0.35' },
      null
    ]);
    expect(updater.getUpdateState()).toBeNull();
  } finally {
    subscription.unsubscribe();
    await runtime.destroy();
    await fixture.cleanup();
  }
});

test('failed restart publishes terminal failure without private error details and clears on a current-version retry', async () => {
  const fixture = await setup();
  const states: TServerUpdateState[] = [];
  const subscription = pubsub
    .subscribe(ServerEvents.SERVER_UPDATE_STATE)
    .subscribe({ next: (state) => states.push(state) });
  try {
    fixture.execve.mockImplementation(() => {
      throw new Error(`exec denied: ${fixture.binary}`);
    });
    await expect(updater.update()).rejects.toThrow('exec denied');
    expect(states.at(-1)).toEqual({
      phase: 'failed',
      targetVersion: '0.0.35'
    });
    expect(updater.getUpdateState()).toEqual({
      phase: 'failed',
      targetVersion: '0.0.35'
    });
    expect(await fs.readFile(fixture.binary, 'utf8')).toBe(
      'old-running-binary'
    );

    fixture.fetchSpy.mockImplementation((async (input, init) => {
      const response = await fixture.transport(input, init);
      const url = String(input);
      if (url.endsWith('/releases/latest')) {
        const release = (await response.json()) as Record<string, unknown>;
        return json({ ...release, tag_name: SERVER_VERSION });
      }
      if (url === releaseRoot + 'release.json') {
        const metadata = (await response.json()) as Record<string, unknown>;
        return json({ ...metadata, version: SERVER_VERSION });
      }
      return response;
    }) as typeof fetch);
    await expect(updater.update()).resolves.toEqual({ updated: false });
    expect(states.slice(-2)).toEqual([{ phase: 'checking' }, null]);
    expect(updater.getUpdateState()).toBeNull();
  } finally {
    subscription.unsubscribe();
    await fixture.cleanup();
  }
});

test('authenticated late subscribers receive current update state and stop receiving it after unsubscribe', async () => {
  const fixture = await setup();
  const { caller } = await getCaller(2, undefined, { authenticated: true });
  const states: TServerUpdateState[] = [];
  const { promise: blocked, resolve: release } = Promise.withResolvers<void>();
  fixture.fetchSpy.mockImplementation((async (input, init) => {
    await blocked;
    return fixture.transport(input, init);
  }) as typeof fetch);
  const update = updater.update();
  let subscription: { unsubscribe(): void } | undefined;
  try {
    const observable = await caller.others.onServerUpdateState();
    subscription = observable.subscribe({
      next: (state) => states.push(state)
    });
    expect(states).toEqual([{ phase: 'checking' }]);
    release();
    await update;
    expect(states.at(-1)).toEqual({
      phase: 'restarting',
      targetVersion: '0.0.35'
    });
    subscription.unsubscribe();
    const received = states.length;
    await updater.update();
    expect(states).toHaveLength(received);
  } finally {
    release();
    await update;
    subscription?.unsubscribe();
    await fixture.cleanup();
  }
});

test('unjoined connections cannot subscribe to server update state', async () => {
  const { caller } = await getCaller(2, undefined, { authenticated: false });
  await expect(caller.others.onServerUpdateState()).rejects.toMatchObject({
    code: 'UNAUTHORIZED'
  });
});

test('automatic download failure is terminal and the next admitted check clears it', async () => {
  const fixture = await setup();
  const runtime = new VoiceRuntime(9000711);
  const states: TServerUpdateState[] = [];
  const subscription = pubsub
    .subscribe(ServerEvents.SERVER_UPDATE_STATE)
    .subscribe({ next: (state) => states.push(state) });
  try {
    runtime.addUser(
      9000711,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(9000711)
    );
    updater.start();
    runtime.removeUser(9000711);
    fixture.fetchSpy.mockImplementation((async (input, init) => {
      if (String(input) === releaseRoot + 'dodecagon-linux-x64')
        return new Response('failed', { status: 503 });
      return fixture.transport(input, init);
    }) as typeof fetch);
    await fixture.tick();
    expect(states).toEqual([
      { phase: 'checking', targetVersion: '0.0.35' },
      { phase: 'downloading', targetVersion: '0.0.35' },
      { phase: 'failed', targetVersion: '0.0.35' }
    ]);
    expect(await fs.readFile(fixture.binary, 'utf8')).toBe(
      'old-running-binary'
    );
    fixture.fetchSpy.mockImplementation((async (input, init) => {
      const response = await fixture.transport(input, init);
      const url = String(input);
      if (url.endsWith('/releases/latest')) {
        const release = (await response.json()) as Record<string, unknown>;
        return json({ ...release, tag_name: SERVER_VERSION });
      }
      if (url === releaseRoot + 'release.json') {
        const metadata = (await response.json()) as Record<string, unknown>;
        return json({ ...metadata, version: SERVER_VERSION });
      }
      return response;
    }) as typeof fetch);
    await fixture.tick();
    expect(states.at(-1)).toBeNull();
    expect(updater.getUpdateState()).toBeNull();
  } finally {
    subscription.unsubscribe();
    await runtime.destroy();
    await fixture.cleanup();
  }
});
