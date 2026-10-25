import { cn } from '@dodecagon/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Example, Section } from './section';

const TOKENS = [
  'canvas',
  'nav',
  'panel',
  'raised',
  'foreground',
  'muted-foreground',
  'primary',
  'accent-text',
  'success',
  'destructive',
  'line',
  'control-border'
] as const;
const SPACING = [1, 2, 3, 4, 6, 8] as const;
const RADII = [
  { name: 'sm', className: 'rounded-sm' },
  { name: 'md', className: 'rounded-md' },
  { name: 'lg', className: 'rounded-lg' },
  { name: 'xl', className: 'rounded-xl' }
] as const;

export const Foundations = memo(() => {
  const { t } = useTranslation('design-system');

  return (
    <Section id="foundations" number="01">
      <p className="mb-6 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
        {t('foundationNote')}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {TOKENS.map((token) => (
          <div
            key={token}
            className="min-w-0 overflow-hidden rounded-lg border border-line bg-nav"
          >
            <div
              className="h-16 border-b border-line"
              style={{ backgroundColor: `var(--${token})` }}
            />
            <code className="block break-all p-3 text-xs leading-relaxed">
              --{token}
            </code>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Example title={t('typography')}>
          <div className="space-y-5">
            <div>
              <code className="text-xs text-muted-foreground">
                Inter Variable / text-3xl / bold
              </code>
              <p className="mt-2 text-3xl font-bold leading-tight tracking-tight">
                {t('typeSample')}
              </p>
            </div>
            <div>
              <code className="text-xs text-muted-foreground">
                text-xl / semibold
              </code>
              <p className="mt-2 text-xl font-semibold leading-snug">
                {t('typeSample')}
              </p>
            </div>
            <div>
              <code className="text-xs text-muted-foreground">
                text-sm / regular
              </code>
              <p className="mt-2 text-sm leading-relaxed">{t('bodySample')}</p>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              font-mono · 0123456789 · --primary
            </p>
          </div>
        </Example>
        <Example title={t('spacingRadii')}>
          <div className="space-y-3">
            {SPACING.map((step) => (
              <div key={step} className="flex items-center gap-4">
                <code className="w-20 shrink-0 text-xs">
                  {step} / {step * 4}px
                </code>
                <div
                  className="h-3 rounded-xs bg-primary"
                  style={{ width: `calc(var(--spacing) * ${step})` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-4">
            {RADII.map((radius) => (
              <div
                key={radius.name}
                className={cn(
                  'flex size-14 items-center justify-center border border-control-border bg-panel font-mono text-xs',
                  radius.className
                )}
              >
                {radius.name}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            <code>--spacing · --radius</code>
          </p>
        </Example>
      </div>
    </Section>
  );
});
