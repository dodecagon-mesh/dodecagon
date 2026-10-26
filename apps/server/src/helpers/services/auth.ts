import {
  ActivityLogType,
  DELETED_USER_IDENTITY_AND_NAME,
  sha256,
  type TBeforeLoginPayload,
  type THttpFieldError,
  type TLoginInput,
  type TLoginResult,
  type TRequestContext
} from '@dodecagon/shared';
import chalk from 'chalk';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import z from 'zod';
import { config } from '../../config';
import { db } from '../../db';
import { createUser } from '../../db/mutations/users';
import { publishUser } from '../../db/publishers';
import { isInviteValid } from '../../db/queries/invites';
import { getServerToken, getSettings } from '../../db/queries/server';
import { getUserByIdentity } from '../../db/queries/users';
import { users } from '../../db/schema';
import { HttpValidationError } from '../../http/errors';
import { logger } from '../../logger';
import { pluginManager } from '../../plugins';
import { runHook } from '../../plugins/run-hook';
import { enqueueActivityLog } from '../../queues/activity-log';
import {
  createRateLimiter,
  getClientRateLimitKey,
  getRateLimitRetrySeconds
} from '../../utils/rate-limiters/rate-limiter';
import { isLocalLoginDisabled } from '../oidc/settings';
import { safeCompare } from '../safe-compare';
import type { TServiceResult } from './service-result';

// the route forwards the body unvalidated, the service owns the rules and the messages
const zLoginBody = z.object({
  identity: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Identity must be at least 1 character long'),
  password: z
    .string()
    .min(4, 'Password must be at least 4 characters long')
    .max(128),
  invite: z.string().optional()
});

const GENERIC_LOGIN_ERROR = 'Invalid credentials';

const loginRateLimiter = createRateLimiter({
  maxRequests: config.rateLimiters.login.maxRequests,
  windowMs: config.rateLimiters.login.windowMs
});

let dummyArgon2HashPromise: Promise<string> | null = null;

const getDummyArgon2Hash = (): Promise<string> => {
  if (!dummyArgon2HashPromise) {
    dummyArgon2HashPromise = Bun.password
      .hash('dodecagon-dummy-password-for-timing')
      .catch((error) => {
        dummyArgon2HashPromise = null;
        throw error;
      });
  }

  return dummyArgon2HashPromise;
};

// a plugin refuses a sign in and the reason is shown on the form
class LoginRejectedError extends Error {}

const toFieldErrors = (error: z.ZodError): THttpFieldError[] => {
  const errors: THttpFieldError[] = [];

  for (const issue of error.issues) {
    const field = issue.path[0];

    if (typeof field === 'string') {
      errors.push({ field, message: issue.message });
    }
  }

  return errors;
};

const fieldError = (field: string, message: string) => ({
  ok: false as const,
  error: { kind: 'field' as const, errors: [{ field, message }] }
});

const consumeLoginRateLimit = (ip: string | undefined) => {
  if (!ip) {
    logger.warn(
      '[Rate Limiter HTTP] Missing IP address in request info, skipping rate limiting for /login route.'
    );

    return { allowed: true, remaining: 0, retryAfterMs: 0 };
  }

  return loginRateLimiter.consume(getClientRateLimitKey(ip));
};

const authenticateUserService = async (
  input: TLoginInput,
  context?: TRequestContext
): Promise<TServiceResult<TLoginResult>> => {
  const parsed = zLoginBody.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: 'field', errors: toFieldErrors(parsed.error) }
    };
  }

  const { identity, password, invite } = parsed.data;

  if (identity === DELETED_USER_IDENTITY_AND_NAME) {
    return fieldError('identity', 'This identity is reserved');
  }

  if (isLocalLoginDisabled()) {
    return fieldError(
      'identity',
      'This server only accepts sign in through its identity provider'
    );
  }

  const settings = await getSettings();
  let existingUser = await getUserByIdentity(identity);

  try {
    await runHook<TBeforeLoginPayload, never>({
      entries: pluginManager.getHooks('beforeLogin'),
      payload: {
        identity,
        ip: context?.ip,
        isExistingUser: !!existingUser
      },
      reject: (message) => {
        throw new LoginRejectedError(message);
      }
    });
  } catch (error) {
    if (!(error instanceof LoginRejectedError)) throw error;

    return fieldError('identity', error.message);
  }

  const rateLimit = consumeLoginRateLimit(context?.ip);

  if (!rateLimit.allowed) {
    return {
      ok: false,
      error: {
        kind: 'rate-limited',
        message: 'Too many login attempts. Please try again shortly.',
        retryAfter: getRateLimitRetrySeconds(rateLimit.retryAfterMs)
      }
    };
  }

  if (!existingUser) {
    const result = await isInviteValid(invite);

    if (!settings.allowNewUsers && result.error) {
      await Bun.password.verify('dummy', await getDummyArgon2Hash());

      logger.info(
        `${chalk.dim('[Auth]')} Login attempt for unknown identity blocked. (reason: ${result.error}, IP: ${context?.ip || 'unknown'})`
      );

      return fieldError('identity', GENERIC_LOGIN_ERROR);
    }

    // only consume the invite when one was actually accepted
    const usedInviteCode = result.invite ? invite : undefined;
    const inviteRoleId = result.invite?.roleId ?? null;

    let registeredUserId: number;

    try {
      // user doesn't exist, but registration is open OR invite was valid - create the user automatically
      registeredUserId = await createUser({
        identity,
        hashedPassword: (await Bun.password.hash(password)).toString(),
        inviteCode: usedInviteCode,
        inviteRoleId
      });
    } catch (error) {
      if (!(error instanceof HttpValidationError)) throw error;

      return fieldError(error.field, error.message);
    }

    existingUser = await getUserByIdentity(identity);

    // the registration committed but the row cannot be read back, which is a broken
    // server and has to stay visible in the log instead of answering a field error
    if (!existingUser) {
      logger.error(
        `${chalk.dim('[Auth]')} User registration did not produce a user for "${identity}"`
      );

      return {
        ok: false,
        error: { kind: 'internal', message: 'Internal server error' }
      };
    }

    // published only once the registration transaction has committed
    publishUser(registeredUserId, 'create');

    if (usedInviteCode) {
      enqueueActivityLog({
        type: ActivityLogType.USED_INVITE,
        userId: registeredUserId,
        details: { code: usedInviteCode },
        ip: context?.ip
      });
    }
  }

  // temporary logic to migrate old SHA256 password hashes to argon2 on login
  const isPasswordArgon = existingUser.password.startsWith('$argon2');

  let passwordMatches = false;

  if (isPasswordArgon) {
    passwordMatches = await Bun.password.verify(
      password,
      existingUser.password
    );
  } else {
    logger.info(
      `${chalk.dim('[Auth]')} User "${existingUser.identity}" is using legacy SHA256 password hash, upgrading to argon2...`
    );

    const hashInputPassword = await sha256(password);

    passwordMatches = safeCompare(hashInputPassword, existingUser.password);

    if (passwordMatches) {
      const argon2Password = await Bun.password.hash(password);

      await db
        .update(users)
        .set({
          password: argon2Password
        })
        .where(eq(users.id, existingUser.id));
    }
  }

  if (!passwordMatches) {
    logger.info(
      `${chalk.dim('[Auth]')} Failed login attempt for user "${existingUser.identity}" due to invalid password. (IP: ${context?.ip || 'unknown'})`
    );

    return fieldError('identity', GENERIC_LOGIN_ERROR);
  }

  if (existingUser.banned) {
    return fieldError(
      'identity',
      `Identity banned: ${existingUser.banReason || 'No reason provided'}`
    );
  }

  const token = jwt.sign(
    { userId: existingUser.id, tokenVersion: existingUser.tokenVersion },
    await getServerToken(),
    {
      expiresIn: '604800s' // 7 days
    }
  );

  return { ok: true, body: { token } };
};

export { authenticateUserService };
