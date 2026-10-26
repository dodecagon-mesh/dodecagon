import type { TServerInfo, TWebAppManifest } from './types';

// the parts of the request the services cannot work out on their own: where the
// server believes it lives, who the caller is and what the browser sent along
export interface TRequestContext {
  origin: string;
  ip?: string;
  secure?: boolean;
  cookie?: string;
}

export interface TLoginInput {
  identity: string;
  password: string;
  invite?: string;
}

export interface TLoginResult {
  token: string;
}

export interface TOidcLoginResult {
  location: string;
  cookie: string;
}

export interface TOidcCallbackInput {
  state: string | null;
  code: string | null;
  error: string | null;
  search?: string;
}

export interface TOidcCallbackResult {
  location: string;
  cookie?: string;
}

export interface TOidcHandoffResult {
  token: string;
  cookie?: string;
}

export interface TOidcLogoutResult {
  userId: string;
}

export interface TServerBridge {
  getServerInfo(): Promise<TServerInfo>;
  getWebAppManifest(): Promise<TWebAppManifest>;
  authenticateUser(
    input: TLoginInput,
    context?: TRequestContext
  ): Promise<TLoginResult>;
  createOidcLogin(context: TRequestContext): Promise<TOidcLoginResult>;
  consumeOidcCallback(
    input: TOidcCallbackInput,
    context: TRequestContext
  ): Promise<TOidcCallbackResult>;
  consumeOidcHandoff(
    code: string,
    context: TRequestContext
  ): Promise<TOidcHandoffResult>;
  verifyBackchannelLogout(
    token: string,
    context: TRequestContext
  ): Promise<TOidcLogoutResult>;
  listPluginComponentIds(): Promise<string[]>;
}

// the start server bundle ships its own copy of this package, so a module level
// variable would leave the bun core and the server routes with two different
// bridges. a key from the global symbol registry is the same in every copy of the
// package inside one process, so both sides read and write one slot
const BRIDGE_KEY = Symbol.for('dodecagon.serverBridge');

type TBridgeSlot = {
  [key: symbol]: TServerBridge | null | undefined;
};

const bridgeSlot = globalThis as unknown as TBridgeSlot;

export const setServerBridge = (value: TServerBridge | null) => {
  bridgeSlot[BRIDGE_KEY] = value;
};

export const getServerBridge = (): TServerBridge => {
  const bridge = bridgeSlot[BRIDGE_KEY];

  if (!bridge) {
    throw new Error('the server bridge is not installed');
  }

  return bridge;
};

// the start server runs in the vite process during development while the bridge
// lives in the bun process, so the caller can fall back to the bun api
export const tryGetServerBridge = (): TServerBridge | null =>
  bridgeSlot[BRIDGE_KEY] ?? null;

// both runtimes read the callback parameters off the url the provider redirected to, and
// the whole search travels with them so the token request carries every parameter
export const toOidcCallbackInput = (url: URL): TOidcCallbackInput => ({
  state: url.searchParams.get('state'),
  code: url.searchParams.get('code'),
  error: url.searchParams.get('error'),
  search: url.search
});

// the handoff code arrives in a body no route has validated yet, so anything that is not
// a string becomes empty and the service rejects it with its own message
export const getOidcHandoffCode = (body: unknown): string => {
  if (typeof body !== 'object' || body === null || !('code' in body)) {
    return '';
  }

  const { code } = body;

  return typeof code === 'string' ? code : '';
};
