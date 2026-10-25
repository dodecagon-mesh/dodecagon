import { TEMPORARY_ATTACHMENT_EXPIRED_MESSAGE } from '@dodecagon/shared';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { messageSendRequests } from '../db/schema';
import { invariant } from '../utils/invariant';

const activeRequests = new Map<string, Promise<number>>();

type TSendRequest = {
  userId: number;
  clientRequestId: string;
  payload: string;
};

const requestWhere = ({ userId, clientRequestId }: TSendRequest) =>
  and(
    eq(messageSendRequests.userId, userId),
    eq(messageSendRequests.clientRequestId, clientRequestId)
  );

const getSendRequest = (request: TSendRequest) => {
  const existing = db
    .select()
    .from(messageSendRequests)
    .where(requestWhere(request))
    .get();
  if (existing) {
    invariant(existing.payload === request.payload, {
      code: 'CONFLICT',
      message: 'This request ID was already used for a different message.'
    });
  }
  return existing;
};

const runMessageSendRequest = (
  request: TSendRequest,
  send: (markIrreversible: () => void) => Promise<number>
): Promise<number> => {
  const existing = getSendRequest(request);
  const key = `${request.userId}:${request.clientRequestId}`;
  if (existing) {
    if (existing.messageId !== null) return Promise.resolve(existing.messageId);
    invariant(existing.failure !== 'completed', {
      code: 'NOT_FOUND',
      message: 'The sent message no longer exists.'
    });
    const active = activeRequests.get(key);
    if (active) return active;
    invariant(false, {
      code: 'CONFLICT',
      message:
        'The previous send was interrupted or failed after processing began. It cannot be replayed safely.'
    });
  }

  db.insert(messageSendRequests)
    .values({
      userId: request.userId,
      clientRequestId: request.clientRequestId,
      payload: request.payload,
      createdAt: Date.now()
    })
    .run();

  // reserve durably before hooks or file moves; a process interruption must not repeat them
  let irreversible = false;
  const operation = Promise.resolve()
    .then(() =>
      send(() => {
        irreversible = true;
      })
    )
    .catch((error: unknown) => {
      const persisted = getSendRequest(request);
      if (!irreversible && persisted?.messageId === null) {
        db.delete(messageSendRequests).where(requestWhere(request)).run();
      } else if (persisted?.messageId === null) {
        db.update(messageSendRequests)
          .set({ failure: 'failed' })
          .where(requestWhere(request))
          .run();
      }
      // only the unclaimed preflight may authorize replacing expired attachment IDs
      invariant(
        !(
          (irreversible || Boolean(persisted?.messageId)) &&
          error instanceof TRPCError &&
          error.code === 'BAD_REQUEST' &&
          error.message === TEMPORARY_ATTACHMENT_EXPIRED_MESSAGE
        ),
        {
          code: 'CONFLICT',
          message:
            'The previous send failed after processing began. It cannot be replayed safely.'
        }
      );
      throw error;
    })
    .finally(() => {
      activeRequests.delete(key);
    });
  activeRequests.set(key, operation);
  return operation;
};

export { getSendRequest, runMessageSendRequest };
