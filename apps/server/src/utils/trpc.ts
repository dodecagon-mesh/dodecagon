import {
  ChannelPermission,
  UserStatus,
  type Permission,
  type ServerEvents,
  type TLocale,
  type TUser
} from '@dodecagon/shared';
import { initTRPC, TRPCError } from '@trpc/server';
import chalk from 'chalk';
import type WebSocket from 'ws';
import { config } from '../config';
import { captureError, shouldReportError } from '../helpers/sentry';
import { logger } from '../logger';
import type { TVoiceConnection } from '../runtimes/voice';
import type { TConnectionInfo } from '../types';
import { invariant } from './invariant';
import { pubsub } from './pubsub';
import {
  createRateLimiter,
  getClientRateLimitKey
} from './rate-limiters/rate-limiter';

export type Context = {
  handshakeHash: string;
  authenticated: boolean;
  pubsub: typeof pubsub;
  user: TUser;
  userId: number;
  token: string;
  currentVoiceChannelId: number | undefined;
  voiceConnection: TVoiceConnection;
  locale: TLocale;
  hasPermission: (
    targetPermission: Permission | Permission[]
  ) => Promise<boolean>;
  needsPermission: (
    targetPermission: Permission | Permission[]
  ) => Promise<void>;
  hasChannelPermission: (
    channelId: number,
    targetPermission: ChannelPermission
  ) => Promise<boolean>;
  needsChannelPermission: (
    channelId: number,
    targetPermission: ChannelPermission
  ) => Promise<void>;
  getOwnWs: () => WebSocket | undefined;
  getStatusById: (userId: number) => UserStatus;
  setWsUserId: (userId: number) => void;
  getUserWs: (userId: number) => WebSocket[];
  getConnectionInfo: () => TConnectionInfo | undefined;
  throwValidationError: (field: string, message: string) => never;
  saveUserIp: (userId: number, ip: string) => Promise<void>;
};

const t = initTRPC.context<Context>().create();

const errorMiddleware = t.middleware(async ({ next, path }) => {
  try {
    return await next();
  } catch (error) {
    if (shouldReportError(error)) {
      captureError(error, { path });
    }

    throw error;
  }
});

const timingMiddleware = t.middleware(async ({ path, next }) => {
  if (!config.server.debug) {
    return next();
  }

  const start = performance.now();
  const result = await next();
  const end = performance.now();
  const duration = end - start;

  logger.debug(
    `${chalk.dim('[tRPC]')} ${chalk.yellow(path)} took ${chalk.green(duration.toFixed(2))} ms`
  );

  return result;
});

const authMiddleware = t.middleware(async ({ ctx, next }) => {
  invariant(ctx.authenticated, {
    code: 'UNAUTHORIZED',
    message: 'You must be authenticated to perform this action.'
  });

  return next();
});

type TRateLimitedProcedureOptions = {
  maxRequests: number;
  windowMs: number;
  logLabel: string;
  maxEntries?: number;
  /**
   * Spend a slot only when the call is rejected. Guessing a password or a handshake is the
   * threat these limits answer, and a session that joins successfully is not one of the
   * attempts: counting reloads and reconnections of a valid session locks the user out of
   * their own client, which is the failure this option exists to prevent.
   */
  countFailuresOnly?: boolean;
  skip?: (rawInput: unknown) => boolean;
};

const rateLimitedProcedure = (
  procedure: typeof t.procedure,
  options: TRateLimitedProcedureOptions
) => {
  const limiter = createRateLimiter({
    maxRequests: options.maxRequests,
    windowMs: options.windowMs,
    maxEntries: options.maxEntries
  });

  const rateLimitMiddleware = t.middleware(
    async ({ ctx, next, path, getRawInput }) => {
      if (options.skip?.(await getRawInput())) return next();
      const connectionInfo = ctx.getConnectionInfo();

      if (!connectionInfo?.ip) {
        // if we have no IP, it means we have no way to identify the client
        // if we can't identify the client, we can't apply rate limiting, so we log a warning and skip it for this request
        logger.warn(
          `${chalk.dim('[Rate Limiter tRPC]')} Missing IP address in connection info, skipping rate limiting for this request. Path: ${path}`
        );

        return next();
      }

      const key = getClientRateLimitKey(
        ctx.userId ? `user:${ctx.userId}` : connectionInfo.ip
      );
      const rateLimit = limiter.consume(key);

      if (!rateLimit.allowed) {
        logger.debug(
          `${chalk.dim('[Rate Limiter tRPC]')} ${options.logLabel} rate limited for key "${key}"`
        );

        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many requests. Please try again shortly.'
        });
      }

      const result = await next();

      // a rejected call answers with ok: false instead of throwing
      if (options.countFailuresOnly && result.ok) {
        limiter.refund(key);
      }

      return result;
    }
  );

  return procedure.use(rateLimitMiddleware);
};

// this should be used for all queries and mutations apart from the join server one
// it prevents users that only are connected to the wss but did not join the server from accessing protected procedures
const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(authMiddleware)
  .use(errorMiddleware);

const publicProcedure = t.procedure.use(timingMiddleware).use(errorMiddleware);

// a subscription that forwards one realtime event. `scope` picks who may receive
// it: everyone, or only the caller. The route name is the contract the client
// subscribes to, so it stays declared at the call site.
const eventSubscription = <TEvent extends ServerEvents>(
  event: TEvent,
  scope: 'everyone' | 'caller' = 'everyone'
) =>
  protectedProcedure.subscription(({ ctx }) => {
    if (scope === 'caller') {
      return ctx.pubsub.subscribeFor(ctx.userId, event);
    }

    return ctx.pubsub.subscribe(event);
  });

export {
  eventSubscription,
  protectedProcedure,
  publicProcedure,
  rateLimitedProcedure,
  t
};
