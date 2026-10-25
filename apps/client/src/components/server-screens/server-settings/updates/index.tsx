import { ServerUpdateStatus } from '@/components/reconnecting-overlay/server-update-notice';
import { SettingsSection } from '@/components/server-screens/settings-shell/section';
import { useAdminUpdates } from '@/features/server/admin/hooks';
import { cn } from '@/lib/utils';
import { Button, LoadingCard } from '@dodecagon/ui';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUpCircleIcon,
  CheckIcon,
  ExclamationCircleIcon
} from '@heroicons/react/24/outline';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

const Updates = memo(() => {
  const { t } = useTranslation(['settings', 'common']);
  const {
    loading,
    checkFailed,
    isUpdating,
    updateState = null,
    hasUpdate,
    latestVersion,
    currentVersion,
    canUpdate,
    refetch,
    update
  } = useAdminUpdates();
  const [isChecking, setIsChecking] = useState(false);

  const checkAgain = useCallback(async () => {
    setIsChecking(true);

    try {
      await refetch();
    } finally {
      setIsChecking(false);
    }
  }, [refetch]);

  // a manual re-check keeps the row on screen, only the first load replaces it
  if (loading && !isChecking) {
    return <LoadingCard className="h-[600px]" />;
  }

  let statusIcon = <CheckIcon className="size-6 text-success" />;
  let statusTitle = t('upToDateTitle');
  let statusDescription = t('upToDateDesc');
  let statusBackground = 'bg-success-solid/25';

  if (isUpdating) {
    statusIcon = (
      <ArrowPathIcon className="size-6 text-accent-text motion-safe:animate-spin" />
    );
    statusTitle = t('forceUpdatePending');
    statusDescription = t('common:serverUpdateHint');
    statusBackground = 'bg-primary/20';
  } else if (updateState?.phase === 'failed') {
    statusIcon = <ExclamationCircleIcon className="size-6 text-destructive" />;
    statusTitle = t('common:serverUpdateFailed');
    statusDescription = t('forceUpdateFailed');
    statusBackground = 'bg-destructive/15';
  } else if (checkFailed) {
    statusIcon = <ExclamationCircleIcon className="size-6 text-destructive" />;
    statusTitle = t('updateCheckFailedTitle');
    statusDescription = t('updateCheckFailedDesc');
    statusBackground = 'bg-destructive/15';
  } else if (!canUpdate) {
    statusIcon = <ExclamationCircleIcon className="size-6 text-destructive" />;
    statusTitle = t('updatesNotSupportedTitle');
    statusDescription = t('updatesNotSupportedDesc');
    statusBackground = 'bg-destructive/15';
  } else if (hasUpdate) {
    statusIcon = <ArrowDownTrayIcon className="size-6 text-accent-text" />;
    statusTitle = t('updateAvailableTitle');
    statusDescription = t('updateAvailableDesc', { version: latestVersion });
    statusBackground = 'bg-primary/20';
  }

  return (
    <SettingsSection
      title={t('updatesTitle')}
      description={t('updatesDesc')}
      action={
        <Button onClick={update} disabled={!canUpdate || isUpdating}>
          <ArrowUpCircleIcon className="size-5" />
          {t(isUpdating ? 'forceUpdatePending' : 'updateServerBtn')}
        </Button>
      }
    >
      <div className="flex w-full max-w-[1040px] flex-col gap-2">
        <div className="flex items-center gap-[15px] py-4">
          <div
            className={`flex size-[42px] shrink-0 items-center justify-center rounded-full ${statusBackground}`}
          >
            {statusIcon}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-base font-bold leading-5 text-foreground">
              {statusTitle}
            </span>
            {updateState ? (
              <ServerUpdateStatus state={updateState} />
            ) : (
              <span className="text-sm leading-4 text-muted-foreground">
                {statusDescription}
              </span>
            )}
          </div>
          {checkFailed && (
            <div className="ml-auto shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={checkAgain}
                disabled={isChecking}
              >
                <ArrowPathIcon
                  className={cn('size-4', isChecking && 'animate-spin')}
                />
                {t('updateCheckAgainBtn')}
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-[30px] border-t border-line pt-2 text-sm leading-4 text-muted-foreground">
          <span>
            {t('currentVersionLabel')}{' '}
            <span className="font-mono">
              {currentVersion || t('unknownVersion')}
            </span>
          </span>
          <span>
            {t('latestVersionLabel')}{' '}
            <span className="font-mono">
              {latestVersion || t('unknownVersion')}
            </span>
          </span>
        </div>
      </div>
    </SettingsSection>
  );
});

export { Updates };
