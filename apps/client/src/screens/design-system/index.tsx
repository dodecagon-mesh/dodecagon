import { ThemeProvider } from '@/components/theme-provider';
import { THEMES } from '@/components/theme-provider/themes';
import { useTheme } from '@/components/theme-provider/use-theme';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@dodecagon/ui';
import '@fontsource-variable/inter';
import '@fontsource-variable/inter/wght-italic.css';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Actions } from './actions';
import { Feedback } from './feedback';
import { Foundations } from './foundations';
import { Inputs } from './inputs';
import { Overlays } from './overlays';
import { VoiceExamples } from './voice-examples';

const SECTIONS = [
  'foundations',
  'actions',
  'inputs',
  'feedback',
  'overlays',
  'voice'
] as const;

const Gallery = memo(() => {
  const { t } = useTranslation('design-system');
  const { theme, setTheme } = useTheme();

  return (
    <div className="h-dvh overflow-y-auto overscroll-contain bg-canvas text-foreground [scroll-padding-top:1.5rem]">
      <a
        href="#gallery-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-md focus:bg-canvas focus:p-4 focus:text-foreground"
      >
        {t('skip')}
      </a>
      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-b border-line bg-nav p-5 sm:p-8 lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-e lg:border-b-0">
          <a
            href="#gallery-content"
            className="inline-block rounded-sm text-base font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground"
          >
            Dodecagon<span className="text-accent-text"> / UI</span>
          </a>
          <p className="mt-2 text-sm text-muted-foreground">{t('reference')}</p>
          <nav
            aria-label={t('sections')}
            className="mt-6 flex flex-wrap gap-x-5 gap-y-3 lg:flex-col lg:items-start lg:gap-4"
          >
            {SECTIONS.map((id, index) => (
              <a
                key={id}
                href={`#${id}`}
                className="rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground"
              >
                <span aria-hidden="true" className="me-2 font-mono text-xs">
                  0{index + 1}
                </span>
                {t(id)}
              </a>
            ))}
          </nav>
          <p className="mt-8 hidden text-xs leading-relaxed text-muted-foreground lg:block">
            packages/ui
            <br />
            React · Tailwind · Base UI
          </p>
        </aside>
        <main
          id="gallery-content"
          tabIndex={-1}
          className="min-w-0 px-5 py-8 outline-none sm:px-10 sm:py-12 lg:px-12"
        >
          <header className="mb-12 flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-[65ch]">
              <p className="mb-3 text-xs font-semibold tracking-widest text-accent-text">
                {t('reference')}
              </p>
              <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                {t('title')}
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                {t('intro')}
              </p>
            </div>
            <div className="w-full min-w-0 sm:w-60">
              <label
                id="gallery-theme-label"
                className="mb-2 block text-sm font-medium"
              >
                {t('theme')}
              </label>
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger
                  aria-labelledby="gallery-theme-label"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-80 overscroll-contain">
                  <SelectItem value="system">{t('system')}</SelectItem>
                  {THEMES.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </header>
          <div className="space-y-16">
            <Foundations />
            <Actions />
            <Inputs />
            <Feedback />
            <Overlays />
            <VoiceExamples />
          </div>
          <footer className="mt-16 border-t border-line pt-6 text-sm leading-relaxed text-muted-foreground">
            {t('scope')}
          </footer>
        </main>
      </div>
    </div>
  );
});

export const DesignSystem = memo(() => (
  <ThemeProvider>
    <Gallery />
  </ThemeProvider>
));
