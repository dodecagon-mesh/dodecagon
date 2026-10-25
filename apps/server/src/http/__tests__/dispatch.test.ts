import { describe, expect, test } from 'bun:test';
import { isStartPath } from '../index';

describe('the path dispatch', () => {
  test('sends the interface and the api paths to the start server', () => {
    expect(isStartPath('/')).toBe(true);
    expect(isStartPath('/connect')).toBe(true);
    expect(isStartPath('/app')).toBe(true);
    expect(isStartPath('/disconnected')).toBe(true);
    expect(isStartPath('/design-system')).toBe(true);
    expect(isStartPath('/info')).toBe(true);
    expect(isStartPath('/manifest.json')).toBe(true);
    expect(isStartPath('/healthz')).toBe(true);
    expect(isStartPath('/login')).toBe(true);
    expect(isStartPath('/plugin-components')).toBe(true);
    expect(isStartPath('/oidc/login')).toBe(true);
    expect(isStartPath('/oidc/callback')).toBe(true);
    expect(isStartPath('/oidc/exchange')).toBe(true);
    expect(isStartPath('/oidc/backchannel-logout')).toBe(true);
  });

  test('sends the server function calls to the start server', () => {
    expect(isStartPath('/_serverFn/abc123')).toBe(true);
    expect(isStartPath('/_serverFn/abc123/xyz')).toBe(true);
    expect(isStartPath('/_serverFn')).toBe(true);
    expect(isStartPath('/_serverFnOther')).toBe(false);
  });

  test('keeps the file and the plugin paths in bun', () => {
    expect(isStartPath('/upload')).toBe(false);
    expect(isStartPath('/public/file.png')).toBe(false);
    expect(isStartPath('/plugin-bundle/demo/client/index.js')).toBe(false);
    expect(isStartPath('/plugins/demo/hook')).toBe(false);
  });

  test('keeps the assets of the interface in bun', () => {
    expect(isStartPath('/assets/index.js')).toBe(false);
    expect(isStartPath('/favicon.ico')).toBe(false);
  });
});
