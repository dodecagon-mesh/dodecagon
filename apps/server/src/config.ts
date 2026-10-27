import { getErrorMessage } from '@dodecagon/shared';
import fs from 'fs/promises';
import { parse, stringify } from 'ini';
import z from 'zod';
import { applyEnvOverrides } from './helpers/apply-env-overrides';
import { ensureServerDirs } from './helpers/ensure-server-dirs';
import { getPrivateIp, getPublicIp } from './helpers/network';
import { CONFIG_INI_PATH } from './helpers/paths';
import { deepMerge } from './utils/deep-merge';
import { IS_DEVELOPMENT, IS_DOCKER, IS_PRODUCTION, IS_TEST } from './utils/env';

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }

  return value;
};

const zRateLimiter = z.object({
  maxRequests: z.coerce.number().int().positive(),
  windowMs: z.coerce.number().int().positive()
});

const zStunUrl = z.string().refine((value) => {
  if (!/^stuns?:[^\s/?#@]+$/.test(value)) return false;
  const authority = value.slice(value.indexOf(':') + 1);
  if (authority.endsWith(':')) return false;
  try {
    const url = new URL(`http://${authority}`);
    return !!url.hostname && (!url.port || Number(url.port) > 0);
  } catch {
    return false;
  }
}, 'Only STUN and STUNS host URLs are allowed');
const zTurnUrl = z.string().refine((value) => {
  if (!/^turns?:[^\s/?#@]+(?:\?transport=(?:udp|tcp))?$/.test(value))
    return false;
  const authority = value.slice(value.indexOf(':') + 1).split('?')[0]!;
  if (authority.endsWith(':')) return false;
  try {
    const url = new URL(`http://${authority}`);
    return !!url.hostname && (!url.port || Number(url.port) > 0);
  } catch {
    return false;
  }
}, 'Only TURN and TURNS host URLs are allowed');
const zConfig = z.object({
  server: z.object({
    host: z.string().trim(),
    port: z.coerce.number().int().positive(),
    debug: z.coerce.boolean(),
    autoupdate: z.coerce.boolean(),
    backupDatabase: z.coerce.boolean(),
    maxRequestBodyBytes: z.coerce.number().int().positive(),
    allowedOrigins: z
      .preprocess(
        (value) => {
          if (Array.isArray(value)) return value;
          if (typeof value === 'string') return value.split(',');

          return [value];
        },
        z.array(z.string().trim().min(1))
      )
      .default(['*']),
    trustedProxies: z
      .preprocess(
        (value) => {
          if (Array.isArray(value)) return value;
          if (typeof value === 'string') return value.split(',');

          return [value];
        },
        z.array(z.string().trim().min(1))
      )
      .default([])
  }),
  oidc: z.object({
    enabled: z.coerce.boolean(),
    issuer: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    redirectUri: z.string(),
    disableLocalLogin: z.coerce.boolean()
  }),
  webRtc: z.object({
    port: z.coerce.number().int().positive(),
    announcedAddress: z.string(),
    maxBitrate: z.coerce.number().int().positive(),
    holepunchMediaEnabled: z
      .preprocess((value) => {
        if (value === 'true') return true;
        if (value === 'false') return false;
        return value;
      }, z.boolean())
      .default(true),
    directScreenStunUrls: z
      .preprocess((value) => {
        if (value === '') return [];
        if (typeof value === 'string') return value.split(',');
        return value;
      }, z.array(zStunUrl).max(8))
      .default([]),
    turnUrls: z
      .preprocess((value) => {
        if (value === '') return [];
        if (typeof value === 'string') return value.split(',');
        return value;
      }, z.array(zTurnUrl).max(8))
      .default([]),
    turnSecret: z
      .string()
      .default('')
      .refine(
        (value) => value === '' || value.length >= 16,
        'TURN secret must be at least 16 characters'
      ),
    turnTtl: z.coerce.number().int().positive().default(3600)
  }),
  // every outbound URL the server or its clients depend on, so a blocked host is
  // a config change instead of a rebuild
  endpoints: z.object({
    updateReleaseApi: z
      .url()
      .default(
        'https://api.github.com/repos/dodecagon-mesh/dodecagon/releases/latest'
      ),
    updateAssetRoot: z
      .url()
      .default(
        'https://github.com/dodecagon-mesh/dodecagon/releases/download/'
      ),
    publicIpEchoUrls: z
      .preprocess((value) => {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') return value.split(',');
        return [value];
      }, z.array(z.url()).min(1))
      .default([
        'https://ipv4.icanhazip.com',
        'https://api.ipify.org?format=json',
        'https://ifconfig.me/ip'
      ]),
    // the browser asks the server for the registry, so only the server needs to
    // reach one of these
    marketplaceRegistryUrls: z
      .preprocess((value) => {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') return value.split(',');
        return [value];
      }, z.array(z.url()).min(1))
      .default([
        'https://raw.githubusercontent.com/Sharkord/plugins/refs/heads/main/plugins.json?raw=true'
      ])
  }),
  rateLimiters: z.object({
    sendAndEditMessage: zRateLimiter,
    joinVoiceChannel: zRateLimiter,
    moveMembers: zRateLimiter,
    login: zRateLimiter,
    joinServer: zRateLimiter,
    upload: zRateLimiter,
    search: zRateLimiter,
    signalTyping: zRateLimiter,
    getMessages: zRateLimiter,
    markAsRead: zRateLimiter,
    toggleMessageReaction: zRateLimiter,
    addEmoji: zRateLimiter,
    openDirectMessage: zRateLimiter,
    handshake: zRateLimiter,
    updatePassword: zRateLimiter,
    adminCreate: zRateLimiter,
    voiceTransport: zRateLimiter,
    voiceStream: zRateLimiter,
    voiceReaction: zRateLimiter,
    useSecretToken: zRateLimiter,
    pluginExecute: zRateLimiter,
    pluginInstall: zRateLimiter,
    pluginRoute: zRateLimiter,
    oidc: zRateLimiter
  })
});

type TConfig = z.infer<typeof zConfig>;

const defaultConfig: TConfig = {
  server: {
    host: '',
    port: 4991,
    debug: IS_DEVELOPMENT,
    autoupdate: IS_PRODUCTION && !IS_DOCKER && !IS_TEST,
    backupDatabase: true,
    maxRequestBodyBytes: 256 * 1024,
    allowedOrigins: ['*'],
    trustedProxies: [
      '127.0.0.1',
      '::1',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      'fc00::/7'
    ]
  },
  oidc: {
    enabled: false,
    issuer: '',
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    disableLocalLogin: false
  },
  webRtc: {
    port: 40000,
    announcedAddress: '',
    maxBitrate: 30_000_000, // 30 Mbps
    holepunchMediaEnabled: true,
    directScreenStunUrls: [],
    turnUrls: [],
    turnSecret: '',
    turnTtl: 3600
  },
  endpoints: {
    updateReleaseApi:
      'https://api.github.com/repos/dodecagon-mesh/dodecagon/releases/latest',
    updateAssetRoot:
      'https://github.com/dodecagon-mesh/dodecagon/releases/download/',
    publicIpEchoUrls: [
      'https://ipv4.icanhazip.com',
      'https://api.ipify.org?format=json',
      'https://ifconfig.me/ip'
    ],
    marketplaceRegistryUrls: [
      'https://raw.githubusercontent.com/Sharkord/plugins/refs/heads/main/plugins.json?raw=true'
    ]
  },
  rateLimiters: {
    sendAndEditMessage: {
      maxRequests: 15,
      windowMs: 60_000
    },
    joinVoiceChannel: {
      maxRequests: 20,
      windowMs: 60_000
    },
    moveMembers: {
      maxRequests: 20,
      windowMs: 60_000
    },
    login: {
      maxRequests: 5,
      windowMs: 60_000
    },
    joinServer: {
      maxRequests: 5,
      windowMs: 60_000
    },
    upload: {
      maxRequests: 30,
      windowMs: 60_000
    },
    search: {
      maxRequests: 15,
      windowMs: 60_000
    },
    signalTyping: {
      maxRequests: 40,
      windowMs: 5_000
    },
    getMessages: {
      maxRequests: 60,
      windowMs: 10_000
    },
    markAsRead: {
      maxRequests: 60,
      windowMs: 10_000
    },
    toggleMessageReaction: {
      maxRequests: 60,
      windowMs: 10_000
    },
    addEmoji: {
      maxRequests: 10,
      windowMs: 60_000
    },
    openDirectMessage: {
      maxRequests: 10,
      windowMs: 60_000
    },
    handshake: {
      maxRequests: 10,
      windowMs: 60_000
    },
    updatePassword: {
      maxRequests: 5,
      windowMs: 60_000
    },
    adminCreate: {
      maxRequests: 60,
      windowMs: 60_000
    },
    voiceTransport: {
      maxRequests: 30,
      windowMs: 60_000
    },
    voiceStream: {
      maxRequests: 200,
      windowMs: 60_000
    },
    voiceReaction: {
      maxRequests: 20,
      windowMs: 30_000
    },
    useSecretToken: {
      maxRequests: 5,
      windowMs: 60_000
    },
    pluginExecute: {
      maxRequests: 60,
      windowMs: 60_000
    },
    pluginInstall: {
      maxRequests: 10,
      windowMs: 60_000
    },
    pluginRoute: {
      maxRequests: 300,
      windowMs: 60_000
    },
    oidc: {
      maxRequests: 30,
      windowMs: 60_000
    }
  }
};

let config: TConfig = structuredClone(defaultConfig);

await ensureServerDirs();

const configExists = await fs.exists(CONFIG_INI_PATH);

if (!configExists) {
  // config does not exist, create it with the default config
  await fs.writeFile(CONFIG_INI_PATH, stringify(config));
} else {
  try {
    // config exists, we need to make sure it is up to date with the schema
    // to make this easy, we will read the existing config, merge it with the default config, and write it back to the file
    // this way we don't have to worry about migrating old config files when we add/remove config options
    const existingConfigText = await fs.readFile(CONFIG_INI_PATH, {
      encoding: 'utf-8'
    });

    const existingConfig = parse(existingConfigText) as Partial<TConfig>;
    const mergedConfig = deepMerge(config, existingConfig);

    config = zConfig.parse(mergedConfig);

    await fs.writeFile(CONFIG_INI_PATH, stringify(config));
  } catch (error) {
    // something went wrong, just log the error and overwrite the config file with the default config
    console.error(
      `Error reading or parsing config.ini. Overwriting with default config. Error: ${getErrorMessage(error)}`
    );

    await fs.writeFile(CONFIG_INI_PATH, stringify(config));
  }
}

const envOverridesMap: Record<string, string> = {
  'server.host': 'DODECAGON_HOST',
  'server.port': 'DODECAGON_PORT',
  'server.debug': 'DODECAGON_DEBUG',
  'server.autoupdate': 'DODECAGON_AUTOUPDATE',
  'server.backupDatabase': 'DODECAGON_BACKUP_DATABASE',
  'server.maxRequestBodyBytes': 'DODECAGON_MAX_REQUEST_BODY_BYTES',
  'server.allowedOrigins': 'DODECAGON_ALLOWED_ORIGINS',
  'server.trustedProxies': 'DODECAGON_TRUSTED_PROXIES',
  'oidc.enabled': 'DODECAGON_OIDC_ENABLED',
  'oidc.issuer': 'DODECAGON_OIDC_ISSUER',
  'oidc.clientId': 'DODECAGON_OIDC_CLIENT_ID',
  'oidc.clientSecret': 'DODECAGON_OIDC_CLIENT_SECRET',
  'oidc.redirectUri': 'DODECAGON_OIDC_REDIRECT_URI',
  'oidc.disableLocalLogin': 'DODECAGON_OIDC_DISABLE_LOCAL_LOGIN',
  'webRtc.port': 'DODECAGON_WEBRTC_PORT',
  'webRtc.announcedAddress': 'DODECAGON_WEBRTC_ANNOUNCED_ADDRESS',
  'webRtc.maxBitrate': 'DODECAGON_WEBRTC_MAX_BITRATE',
  'webRtc.holepunchMediaEnabled': 'DODECAGON_WEBRTC_HOLEPUNCH_MEDIA_ENABLED',
  'webRtc.directScreenStunUrls': 'DODECAGON_WEBRTC_DIRECT_SCREEN_STUN_URLS',
  'webRtc.turnUrls': 'DODECAGON_WEBRTC_TURN_URLS',
  'webRtc.turnSecret': 'DODECAGON_WEBRTC_TURN_SECRET',
  'webRtc.turnTtl': 'DODECAGON_WEBRTC_TURN_TTL',
  'endpoints.updateReleaseApi': 'DODECAGON_ENDPOINTS_UPDATE_RELEASE_API',
  'endpoints.updateAssetRoot': 'DODECAGON_ENDPOINTS_UPDATE_ASSET_ROOT',
  'endpoints.publicIpEchoUrls': 'DODECAGON_ENDPOINTS_PUBLIC_IP_ECHO_URLS',
  'endpoints.marketplaceRegistryUrls':
    'DODECAGON_ENDPOINTS_MARKETPLACE_REGISTRY_URLS'
};

// validated again after the overrides, otherwise an env var could put a value
// in the config that does not match its type at all
config = zConfig.parse(applyEnvOverrides(config, envOverridesMap));
config = IS_TEST ? config : deepFreeze(config);

const SERVER_PRIVATE_IP = await getPrivateIp();

// only used as the mediasoup announced address when the operator has not set
// one, so an explicit announcedAddress makes the third party lookup pointless
const SERVER_PUBLIC_IP = config.webRtc.announcedAddress
  ? undefined
  : await getPublicIp(config.endpoints.publicIpEchoUrls);

export {
  config,
  deepFreeze,
  defaultConfig,
  envOverridesMap,
  SERVER_PRIVATE_IP,
  SERVER_PUBLIC_IP,
  zConfig
};
