import { disconnectFromServer } from '@/features/server/actions';
import {
  useReconnectState,
  useServerUpdateState
} from '@/features/server/hooks';
import { Button } from '@dodecagon/ui';
import { ArrowPathIcon, SignalSlashIcon } from '@heroicons/react/24/outline';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ServerUpdateStatus } from './server-update-notice';
import { useCountdownSeconds } from './use-countdown-seconds';

const ReconnectingOverlay = memo(() => {
  const { t } = useTranslation('common');
  const reconnect = useReconnectState();
  const updateState = useServerUpdateState();
  const abortButton = useRef<HTMLButtonElement>(null);
  const secondsLeft = useCountdownSeconds(reconnect?.nextAttemptAt ?? null);

  const handleAbort = useCallback(() => disconnectFromServer(), []);

  useEffect(() => {
    const previousFocus = document.activeElement;
    abortButton.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  if (!reconnect) return null;

  const isAttemptInFlight = reconnect.nextAttemptAt === null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reconnect-title"
      aria-describedby="reconnect-explanation"
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          event.preventDefault();
          abortButton.current?.focus();
        }
      }}
      className="fixed inset-0 z-40 flex overflow-y-auto bg-canvas py-8"
    >
      <div className="m-auto flex w-full max-w-sm flex-col items-center gap-5 px-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-full border border-line bg-panel">
          {isAttemptInFlight ? (
            <ArrowPathIcon
              aria-hidden="true"
              className="size-6 text-accent-text motion-safe:animate-spin"
            />
          ) : (
            <SignalSlashIcon
              aria-hidden="true"
              className="size-6 text-accent-text"
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <h2 id="reconnect-title" className="text-xl font-semibold">
            {t(updateState ? 'serverUpdateTitle' : 'reconnectingTitle')}
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {isAttemptInFlight
              ? t('reconnectingNow')
              : t('reconnectingIn', { count: secondsLeft })}
          </p>
        </div>

        {updateState && (
          <div role="status" aria-live="polite" aria-atomic="true">
            <ServerUpdateStatus state={updateState} />
          </div>
        )}

        <p className="text-xs text-subtle-foreground">
          {t('reconnectingAttempt', { attempt: reconnect.attempt })}
        </p>

        <p
          id="reconnect-explanation"
          className="text-xs text-subtle-foreground"
        >
          {t('reconnectingHint')}
        </p>

        <Button
          ref={abortButton}
          className="h-auto min-h-8 max-w-full whitespace-normal"
          variant="outline"
          size="sm"
          onClick={handleAbort}
        >
          {t('reconnectingAbort')}
        </Button>
      </div>
    </div>
  );
});

export { ReconnectingOverlay };
