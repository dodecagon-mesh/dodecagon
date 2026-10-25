import {
  getLocalStorageItem,
  LocalStorageKey,
  setLocalStorageItem
} from '@/helpers/storage';
import type { TLocale } from '@dodecagon/shared';
import type { Locale } from 'date-fns';
import { cs, enUS, es, fr, it, ptBR, ru, zhCN } from 'date-fns/locale';
import type { Resource } from 'i18next';
import i18next, { type i18n as TI18nInstance } from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', dateLocale: enUS }, // English should always be first
  { code: 'cs', label: 'Čeština', dateLocale: cs },
  { code: 'es', label: 'Español', dateLocale: es },
  { code: 'fr', label: 'Français', dateLocale: fr },
  { code: 'it', label: 'Italiano', dateLocale: it },
  { code: 'ru', label: 'Русский', dateLocale: ru },
  { code: 'zh', label: '中文', dateLocale: zhCN },
  { code: 'pt-BR', label: 'Português (Brasil)', dateLocale: ptBR }
] satisfies Array<{ code: TLocale; label: string; dateLocale: Locale }>;

export type SupportedLanguage = TLocale;

const NAMESPACE_LIST = [
  'common',
  'connect',
  'disconnected',
  'sidebar',
  'topbar',
  'dialogs',
  'settings',
  'keybindings',
  'permissions',
  'audio',
  'design-system'
];

const I18N_OPTIONS = {
  fallbackLng: 'en',
  ns: NAMESPACE_LIST,
  defaultNS: 'common',
  fallbackNS: 'common',
  interpolation: {
    escapeValue: false
  }
};

// the language of the user lives in the browser, but the server has to render
// the page in that language, so the choice travels in a cookie next to the
// storage of the browser
const LANGUAGE_COOKIE = 'dodecagon-language';

const isSupportedLanguage = (value: string): value is SupportedLanguage =>
  SUPPORTED_LANGUAGES.some((l) => l.code === value);

export const detectLanguageFromCookie = (
  cookie: string | null
): SupportedLanguage | null => {
  if (!cookie) {
    return null;
  }

  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');

    if (name === LANGUAGE_COOKIE) {
      const value = rest.join('=');

      return isSupportedLanguage(value) ? value : null;
    }
  }

  return null;
};

const setLanguageCookie = (language: SupportedLanguage): void => {
  if (typeof document === 'undefined') return;

  document.cookie = `${LANGUAGE_COOKIE}=${language}; path=/; max-age=31536000; samesite=lax`;
};

const getLanguageCookie = (): SupportedLanguage | null => {
  if (typeof document === 'undefined') return null;

  return detectLanguageFromCookie(document.cookie);
};

const savedLanguage = getLocalStorageItem(LocalStorageKey.LANGUAGE);

const detectBrowserLanguage = (): SupportedLanguage => {
  try {
    const browserLangs = navigator.languages ?? [navigator.language];

    for (const lang of browserLangs) {
      const code = lang.split('-')[0];

      if (SUPPORTED_LANGUAGES.some((l) => l.code === code)) {
        return code as SupportedLanguage;
      }
    }
  } catch {
    // ignore
  }

  return 'en';
};

const isSavedLanguageValid =
  savedLanguage && SUPPORTED_LANGUAGES.some((l) => l.code === savedLanguage);

// the cookie of the user wins, the storage of the browser is the older place
// of the choice and the browser itself is the last guess
const detectInitialLanguage = (): SupportedLanguage => {
  const cookieLanguage = getLanguageCookie();

  if (cookieLanguage) return cookieLanguage;
  if (isSavedLanguageValid) return savedLanguage;

  return detectBrowserLanguage();
};

const initialLanguage: SupportedLanguage = detectInitialLanguage();

// the language of the request of the server, the cookie is the only place
// where the server finds the choice of the user. the value is read before the
// browser writes the cookie of the choice, the server cannot see the cookie
// of a request that is already running
const languageOfRequest = getLanguageCookie() ?? detectBrowserLanguage();

const getLanguageCode = (value: string): string => {
  const [tag] = value.split(';');
  const [code] = tag.trim().split('-');

  return code;
};

// the server has no local storage and no navigator, so the language of a request
// comes from the header of the browser
export const detectLanguageFromHeader = (
  header: string | null
): SupportedLanguage => {
  if (!header) {
    return 'en';
  }

  for (const part of header.split(',')) {
    const code = getLanguageCode(part);

    if (SUPPORTED_LANGUAGES.some((l) => l.code === code)) {
      return code as SupportedLanguage;
    }
  }

  return 'en';
};

const loadResources = (language: string, namespace: string) =>
  import(`./locales/${language}/${namespace}.json`);

// the storage of the language belongs to the client, a server instance must not
// write to it
const persistLanguage = (instance: TI18nInstance): void => {
  if (typeof window === 'undefined') return;

  instance.on('languageChanged', (lng) => {
    setLocalStorageItem(LocalStorageKey.LANGUAGE, lng);
    setLanguageCookie(lng);
  });
};

// the resources of a language are loaded by the server and handed to the browser,
// so the first render of the browser shows the same text as the server
export const createI18n = (
  language: SupportedLanguage,
  resources?: Resource
): TI18nInstance => {
  const instance = i18next.createInstance();

  instance
    .use(initReactI18next)
    .use(resourcesToBackend(loadResources))
    .init({ ...I18N_OPTIONS, lng: language, resources });

  // the resources of the request are enough for the first render of the
  // browser, so the instance is ready right away and the render matches the
  // html of the server. the flag comes after the init: with it i18next asks the
  // backend for the languages the resources do not carry. without it a language
  // change finds nothing and the interface shows the raw keys
  instance.options.partialBundledLanguages = true;

  persistLanguage(instance);

  return instance;
};

export const whenI18nReady = (instance: TI18nInstance): Promise<unknown> => {
  if (instance.isInitialized) {
    return Promise.resolve(instance);
  }

  return new Promise((resolve) => {
    instance.on('initialized', () => resolve(instance));
  });
};

// the browser knows the language of the user, the server could only guess it
// from the header of the request
export const getSavedLanguage = (): SupportedLanguage | null =>
  getLanguageCookie() ?? (isSavedLanguageValid ? savedLanguage : null);

// the server renders every request in the language of the request, and a
// request that is already running cannot carry the choice of the user. the
// choice of the older versions lives in the storage of the browser only, so
// the server needs the page again with the cookie. the page asks for itself
// and the server renders it in the language of the user
export const prepareLanguageCookie = (): boolean => {
  if (typeof document === 'undefined') return false;
  if (!isSavedLanguageValid) return false;

  // the server rendered the page in the language of the request, and the
  // choice of the user is another one
  if (languageOfRequest === savedLanguage) return false;

  setLanguageCookie(savedLanguage);

  // a browser that does not keep the cookie would ask for itself again and
  // again, so the page only asks when the cookie is really there
  return getLanguageCookie() === savedLanguage;
};

export const getLanguageResources = (
  instance: TI18nInstance,
  language: SupportedLanguage
): Resource => {
  const resources: Resource = {};
  const namespaces = instance.options.ns ?? [];

  for (const namespace of namespaces) {
    const bundle = instance.getResourceBundle(language, namespace);

    if (bundle) {
      resources[language] = { ...resources[language], [namespace]: bundle };
    }
  }

  return resources;
};

const clientInstance = i18next.createInstance();

export const i18nReady = clientInstance
  .use(initReactI18next)
  .use(resourcesToBackend(loadResources))
  .init({ ...I18N_OPTIONS, lng: initialLanguage });

persistLanguage(clientInstance);

// the choice of the older versions lives in the storage of the browser only, the
// server needs it in a cookie
if (isSavedLanguageValid && !getLanguageCookie()) {
  setLanguageCookie(savedLanguage);
}

export const i18n = clientInstance;
