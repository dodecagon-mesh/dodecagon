import { describe, expect, test } from 'bun:test';
import {
  createI18n,
  detectLanguageFromCookie,
  detectLanguageFromHeader,
  getLanguageResources,
  SUPPORTED_LANGUAGES,
  whenI18nReady
} from '../index';
import keybindingsEn from '../locales/en/keybindings.json';

describe('the i18n factory', () => {
  test('creates an instance for the given language', async () => {
    const instance = createI18n('ru');

    await instance.init();

    expect(instance.language).toBe('ru');
  });

  test('keeps two instances apart', async () => {
    const first = createI18n('en');
    const second = createI18n('es');

    await Promise.all([first.init(), second.init()]);

    expect(first.language).toBe('en');
    expect(second.language).toBe('es');
  });

  test('takes the language of a request from its header', () => {
    expect(detectLanguageFromHeader('ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru');
    expect(detectLanguageFromHeader('de-DE,de;q=0.9')).toBe('en');
    expect(detectLanguageFromHeader(null)).toBe('en');
  });

  test('takes the language of the user from the cookie of the request', () => {
    expect(detectLanguageFromCookie('dodecagon-language=ru')).toBe('ru');
    expect(
      detectLanguageFromCookie('theme=dark; dodecagon-language=pt-BR; other=1')
    ).toBe('pt-BR');
    expect(detectLanguageFromCookie('dodecagon-language=de')).toBeNull();
    expect(detectLanguageFromCookie('theme=dark')).toBeNull();
    expect(detectLanguageFromCookie(null)).toBeNull();
  });

  test('loads the language of the user when the resources carry another one', async () => {
    const server = createI18n('ru');

    await whenI18nReady(server);

    const resources = getLanguageResources(server, 'ru');
    const browser = createI18n('ru', resources);

    expect(browser.t('identityLabel', { ns: 'connect' })).toBe('Логин');

    await browser.changeLanguage('en');

    expect(browser.language).toBe('en');
    expect(browser.t('identityLabel', { ns: 'connect' })).toBe('Identity');
  });
});

test('every supported locale registers complete keybinding copy and interpolation values', async () => {
  for (const { code } of SUPPORTED_LANGUAGES) {
    const instance = createI18n(code);
    await whenI18nReady(instance);
    const messages = instance.getResourceBundle(code, 'keybindings') as Record<
      string,
      string
    >;
    expect(Object.keys(messages).sort()).toEqual(
      Object.keys(keybindingsEn).sort()
    );
    for (const [key, source] of Object.entries(keybindingsEn)) {
      expect(typeof messages[key]).toBe('string');
      expect(messages[key].trim().length).toBeGreaterThan(0);
      expect(messages[key].match(/\{\{\w+\}\}/g)?.sort() ?? []).toEqual(
        source.match(/\{\{\w+\}\}/g)?.sort() ?? []
      );
    }
  }
});
