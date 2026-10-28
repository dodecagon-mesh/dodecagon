import { ActivityLogType } from '@dodecagon/shared';
import { expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getMockedToken } from '../../__tests__/helpers';
import { tdb, testsBaseUrl } from '../../__tests__/setup';
import { config } from '../../config';
import { activityLog } from '../../db/schema';
import { updater, type TUpdateRequest } from '../../helpers/updater';
import { drainActivityLogQueue } from '../../queues/activity-log';

const ADMIN = 1;
const MEMBER = 2;

const call = (
  method: 'GET' | 'POST',
  token?: string,
  body?: unknown,
  headers: Record<string, string> = {}
) =>
  fetch(`${testsBaseUrl}/admin/update`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

test('should refuse an update without a token', async () => {
  const response = await call('POST', undefined, {});

  expect(response.status).toBe(401);
});

test('should refuse an update with a token that is not a session', async () => {
  const response = await call('POST', 'not-a-token', {});

  expect(response.status).toBe(401);
});

test('should refuse an update from an account without MANAGE_UPDATES', async () => {
  const response = await call('POST', await getMockedToken(MEMBER), {});

  expect(response.status).toBe(403);
});

test('should refuse a caller of another origin', async () => {
  const response = await call(
    'POST',
    await getMockedToken(ADMIN),
    {},
    {
      origin: 'https://evil.example'
    }
  );

  expect(response.status).toBe(403);
});

test('should refuse a request that names something other than a release version', async () => {
  const response = await call('POST', await getMockedToken(ADMIN), {
    targetVersion: 'latest; curl evil'
  });

  expect(response.status).toBe(400);
});

test('should answer the status of the update without changing anything', async () => {
  const update = spyOn(updater, 'update');
  spyOn(updater, 'getUpdateState').mockReturnValue(null);

  const response = await call('GET', await getMockedToken(ADMIN));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    canUpdate: false,
    state: null
  });
  expect(update).not.toHaveBeenCalled();
});

test('should refuse an installation this server cannot perform', async () => {
  const response = await call('POST', await getMockedToken(ADMIN), {});

  // the test build has no execve, which is what a docker image or a windows build
  // looks like to the endpoint
  expect(response.status).toBe(501);
});

test('should refuse a second update while one is running', async () => {
  spyOn(updater, 'canUpdate').mockReturnValue(true);
  spyOn(updater, 'getUpdateState').mockReturnValue({
    phase: 'downloading',
    targetVersion: '9.9.9'
  });

  const response = await call('POST', await getMockedToken(ADMIN), {});

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ accepted: false });
});

test('should accept the update, record who asked for it and answer before the install', async () => {
  const accepted = Promise.withResolvers<TUpdateRequest>();

  spyOn(updater, 'canUpdate').mockReturnValue(true);
  spyOn(updater, 'update').mockImplementation(async (request = {}) => {
    accepted.resolve(request);

    return { updated: false };
  });

  const response = await call('POST', await getMockedToken(ADMIN), {
    targetVersion: '9.9.9',
    allowDowngrade: true
  });

  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({
    accepted: true,
    targetVersion: '9.9.9',
    allowDowngrade: true
  });

  // the request runs after the answer leaves: an install replaces the process that would
  // have written the response. the promise of the mock is the signal that it started
  expect(await accepted.promise).toEqual({
    targetVersion: '9.9.9',
    allowDowngrade: true
  });

  await drainActivityLogQueue();

  const entry = await tdb
    .select({ userId: activityLog.userId, details: activityLog.details })
    .from(activityLog)
    .where(eq(activityLog.type, ActivityLogType.SERVER_UPDATE_REQUESTED))
    .get();

  expect(entry?.userId).toBe(ADMIN);
  expect(entry?.details).toMatchObject({
    targetVersion: '9.9.9',
    allowDowngrade: true
  });
});

test('should stop an account from asking for an update over and over', async () => {
  const { maxRequests } = config.rateLimiters.adminUpdate;
  const token = await getMockedToken(ADMIN);

  for (let attempt = 0; attempt < maxRequests; attempt++) {
    await call('POST', token, {});
  }

  const response = await call('POST', token, {});

  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({
    error: expect.stringContaining('Too many update requests')
  });
});
