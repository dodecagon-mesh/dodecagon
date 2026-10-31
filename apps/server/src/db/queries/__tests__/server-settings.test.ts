import { expect, test } from 'bun:test';
import { config } from '../../../config';
import { getPublicSettings } from '../server';

test('public settings carry the STUN list the media transports use', async () => {
  const savedStun = config.webRtc.directScreenStunUrls;
  const savedTurn = config.webRtc.turnUrls;

  config.webRtc.directScreenStunUrls = ['stun:stun.example.org:3478'];
  config.webRtc.turnUrls = ['turn:turn.example.org:3478'];

  try {
    const settings = await getPublicSettings();

    expect(settings.webRtcStunUrls).toEqual(['stun:stun.example.org:3478']);
    // TURN endpoints and the shared secret stay on the server
    expect(settings).not.toHaveProperty('turnUrls');
    expect(settings).not.toHaveProperty('turnSecret');
  } finally {
    config.webRtc.directScreenStunUrls = savedStun;
    config.webRtc.turnUrls = savedTurn;
  }
});

test('public branding includes the configured server name and explicit absent logo without exposing its token', async () => {
  const settings = await getPublicSettings();
  expect(settings).toMatchObject({ name: 'Test Server', logo: null });
  expect(settings).not.toHaveProperty('secretToken');
});

test('public settings expose only a valid tracker DSN for the browser', async () => {
  const saved = process.env.SENTRY_DSN;
  const savedClient = process.env.SENTRY_CLIENT_DSN;
  try {
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_CLIENT_DSN;
    expect((await getPublicSettings()).sentryDsn).toBeNull();

    process.env.SENTRY_DSN = 'https://server@errors.example.com/1';
    process.env.SENTRY_CLIENT_DSN = 'https://client@errors.example.com/2';
    expect((await getPublicSettings()).sentryDsn).toBe(
      'https://client@errors.example.com/2'
    );

    delete process.env.SENTRY_CLIENT_DSN;
    expect((await getPublicSettings()).sentryDsn).toBe(
      'https://server@errors.example.com/1'
    );

    process.env.SENTRY_CLIENT_DSN = 'javascript:alert(1)';
    expect((await getPublicSettings()).sentryDsn).toBeNull();
  } finally {
    if (saved === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = saved;
    if (savedClient === undefined) delete process.env.SENTRY_CLIENT_DSN;
    else process.env.SENTRY_CLIENT_DSN = savedClient;
  }
});
