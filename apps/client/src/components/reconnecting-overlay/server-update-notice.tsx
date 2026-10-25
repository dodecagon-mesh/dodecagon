import { setServerUpdateState } from '@/features/server/actions';
import { useServerUpdateState } from '@/features/server/hooks';
import type { TServerUpdateState } from '@dodecagon/shared';
import { Button } from '@dodecagon/ui';
import {
  ArrowPathIcon,
  ExclamationCircleIcon
} from '@heroicons/react/24/outline';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const phaseKeys = {
  checking: 'serverUpdateChecking',
  downloading: 'serverUpdateDownloading',
  installing: 'serverUpdateInstalling',
  restarting: 'serverUpdateRestarting',
  failed: 'serverUpdateFailed'
} as const;

export const ServerUpdateStatus = ({
  state
}: {
  state: NonNullable<TServerUpdateState>;
}) => {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-sm">{t(phaseKeys[state.phase])}</p>
      {state.targetVersion && (
        <p className="text-xs text-muted-foreground">
          {t('serverUpdateTarget', { version: state.targetVersion })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t(
          state.phase === 'failed'
            ? 'serverUpdateFailedHint'
            : 'serverUpdateHint'
        )}
      </p>
    </div>
  );
};

export const ServerUpdateNotice = memo(() => {
  const { t } = useTranslation('common');
  const state = useServerUpdateState();
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {state && (
        <aside className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl items-start gap-3 rounded-lg border border-line bg-panel p-4 shadow-lg">
          {state.phase === 'failed' ? (
            <ExclamationCircleIcon
              aria-hidden="true"
              className="size-5 shrink-0 text-destructive"
            />
          ) : (
            <ArrowPathIcon
              aria-hidden="true"
              className="size-5 shrink-0 text-accent-text motion-safe:animate-spin"
            />
          )}
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="font-semibold">{t('serverUpdateTitle')}</p>
            <ServerUpdateStatus state={state} />
          </div>
          {state.phase === 'failed' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setServerUpdateState(null)}
            >
              {t('close')}
            </Button>
          )}
        </aside>
      )}
    </div>
  );
});
