import { Button, IconButton, Spinner } from '@dodecagon/ui';
import { PlusIcon } from '@heroicons/react/24/outline';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Example, Section } from './section';

const VARIANTS = [
  'default',
  'secondary',
  'outline',
  'ghost',
  'link',
  'destructive'
] as const;
const SIZES = ['sm', 'default', 'lg'] as const;
const ICON_SIZES = ['icon-xs', 'icon-sm', 'icon'] as const;
const ICON_VARIANTS = [
  'default',
  'primary',
  'secondary',
  'ghost',
  'destructive'
] as const;
const ICON_BUTTON_SIZES = ['xs', 'sm', 'default', 'lg', 'xl'] as const;

export const Actions = memo(() => {
  const { t } = useTranslation('design-system');
  const [count, setCount] = useState(0);
  const activate = useCallback(() => setCount((value) => value + 1), []);

  return (
    <Section id="actions" number="02">
      <p className="mb-6 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
        {t('actionsNote')}
      </p>
      <div className="grid gap-6 xl:grid-cols-2">
        <Example title="Button / variant">
          <div className="flex flex-wrap items-center gap-3">
            {VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} onClick={activate}>
                {variant}
              </Button>
            ))}
          </div>
        </Example>
        <Example title="Button / size">
          <div className="flex flex-wrap items-center gap-3">
            {SIZES.map((size) => (
              <Button
                key={size}
                size={size}
                variant="outline"
                onClick={activate}
              >
                {size}
              </Button>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-end gap-5">
            {ICON_SIZES.map((size) => (
              <div key={size} className="flex flex-col items-center gap-2">
                <Button
                  size={size}
                  variant="outline"
                  aria-label={t('activate')}
                  onClick={activate}
                >
                  <PlusIcon aria-hidden="true" />
                </Button>
                <code className="text-xs text-muted-foreground">{size}</code>
              </div>
            ))}
          </div>
        </Example>
        <Example title="IconButton / variant · size">
          <div className="flex flex-wrap items-center gap-4">
            {ICON_VARIANTS.map((variant) => (
              <IconButton
                key={variant}
                variant={variant}
                icon={PlusIcon}
                aria-label={`${t('activate')} (${variant})`}
                onClick={activate}
              />
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-end gap-4">
            {ICON_BUTTON_SIZES.map((size) => (
              <div key={size} className="flex flex-col items-center gap-2">
                <IconButton
                  size={size}
                  icon={PlusIcon}
                  aria-label={`${t('activate')} (${size})`}
                  onClick={activate}
                />
                <code className="text-xs text-muted-foreground">{size}</code>
              </div>
            ))}
          </div>
        </Example>
        <Example title={t('states')}>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled>{t('disabled')}</Button>
            <Button disabled aria-busy="true">
              <Spinner size="xxs" aria-hidden="true" />
              {t('loading')}
            </Button>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {t('disabledNote')}
          </p>
        </Example>
      </div>
      <p
        role="status"
        className="mt-4 min-h-6 text-sm tabular-nums text-muted-foreground"
      >
        {t('actionCount', { count })}
      </p>
    </Section>
  );
});
