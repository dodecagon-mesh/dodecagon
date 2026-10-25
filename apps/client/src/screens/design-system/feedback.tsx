import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@dodecagon/ui';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  RectangleStackIcon
} from '@heroicons/react/24/outline';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Example, Section } from './section';

const BADGES = ['default', 'secondary', 'outline', 'destructive'] as const;
const SPINNERS = ['xxs', 'xs', 'sm', 'md', 'lg'] as const;

export const Feedback = memo(() => {
  const { t } = useTranslation('design-system');
  const [hasItem, setHasItem] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const addItem = useCallback(() => setHasItem(true), []);
  const clearItem = useCallback(() => setHasItem(false), []);
  const retry = useCallback(() => setRecovered(true), []);
  const resetError = useCallback(() => setRecovered(false), []);

  return (
    <Section id="feedback" number="04">
      <div className="grid gap-6 xl:grid-cols-2">
        <Example title="Alert">
          <div className="space-y-4">
            <Alert role="note">
              <InformationCircleIcon aria-hidden="true" />
              <AlertTitle className="line-clamp-none">
                {t('example')}
              </AlertTitle>
              <AlertDescription>{t('safeNote')}</AlertDescription>
            </Alert>
            <Alert variant="info" role="note">
              <InformationCircleIcon aria-hidden="true" />
              <AlertTitle className="line-clamp-none">
                {t('infoExample')}
              </AlertTitle>
              <AlertDescription>{t('safeNote')}</AlertDescription>
            </Alert>
            <Alert variant="destructive" role="note">
              <ExclamationTriangleIcon aria-hidden="true" />
              <AlertTitle className="line-clamp-none">
                {t('errorExample')}
              </AlertTitle>
              <AlertDescription>{t('errorRecovery')}</AlertDescription>
            </Alert>
          </div>
        </Example>
        <Example title="Badge · Spinner">
          <div className="flex flex-wrap gap-3">
            {BADGES.map((variant) => (
              <Badge key={variant} variant={variant}>
                {variant}
              </Badge>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-end gap-5">
            {SPINNERS.map((size) => (
              <div key={size} className="flex flex-col items-center gap-2">
                <Spinner size={size} aria-hidden="true" />
                <code className="text-xs text-muted-foreground">{size}</code>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {t('loadingNote')}
          </p>
        </Example>
        <Example title={t('emptyExample')}>
          <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
            {hasItem ? (
              <CheckCircleIcon
                aria-hidden="true"
                className="size-8 text-success"
              />
            ) : (
              <RectangleStackIcon
                aria-hidden="true"
                className="size-8 text-muted-foreground"
              />
            )}
            <p className="text-sm font-semibold">
              {hasItem ? t('itemCreated') : t('emptyTitle')}
            </p>
            <p className="max-w-72 text-sm leading-relaxed text-muted-foreground">
              {t('emptyNote')}
            </p>
            <Button variant="outline" onClick={hasItem ? clearItem : addItem}>
              {hasItem ? t('reset') : t('addExample')}
            </Button>
          </div>
        </Example>
        <Example title={t('errorExample')}>
          <div className="flex min-h-52 flex-col items-start justify-center gap-3">
            {recovered ? (
              <CheckCircleIcon
                aria-hidden="true"
                className="size-7 text-success"
              />
            ) : (
              <ExclamationTriangleIcon
                aria-hidden="true"
                className="size-7 text-destructive"
              />
            )}
            <p role="status" className="text-sm font-semibold">
              {recovered ? t('recovered') : t('errorTitle')}
            </p>
            <p className="max-w-72 text-sm leading-relaxed text-muted-foreground">
              {t('errorRecovery')}
            </p>
            <Button variant="outline" onClick={recovered ? resetError : retry}>
              {recovered ? t('reset') : t('retry')}
            </Button>
          </div>
        </Example>
      </div>
      <div className="mt-6">
        <Example title="Tabs">
          <Tabs defaultValue="overview">
            <TabsList
              aria-label={t('navigationExample')}
              className="h-auto max-w-full flex-wrap gap-x-4"
            >
              <TabsTrigger value="overview">{t('overview')}</TabsTrigger>
              <TabsTrigger value="details">{t('details')}</TabsTrigger>
              <TabsTrigger value="disabled" disabled>
                {t('disabled')}
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="overview"
              className="pt-4 text-sm leading-relaxed text-muted-foreground"
            >
              {t('tabsOverview')}
            </TabsContent>
            <TabsContent
              value="details"
              className="pt-4 text-sm leading-relaxed text-muted-foreground"
            >
              {t('tabsDetails')}
            </TabsContent>
          </Tabs>
        </Example>
      </div>
    </Section>
  );
});
