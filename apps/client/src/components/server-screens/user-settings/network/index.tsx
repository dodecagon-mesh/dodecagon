import { SettingsSection } from '@/components/server-screens/settings-shell/section';
import { usePublicServerSettings } from '@/features/server/hooks';
import {
  describeNetworkVerdict,
  type TNetworkVerdictTone
} from '@/helpers/network-reachability';
import {
  getNetworkStatus,
  type TNetworkStatus
} from '@/helpers/network-status';
import { cn } from '@/lib/utils';
import { Button } from '@dodecagon/ui';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

// a tone maps to the accent bar of the verdict card and to nothing else, so the
// text keeps the contrast of the theme
const TONE_ACCENT: Record<TNetworkVerdictTone, string> = {
  success: 'border-l-success',
  warning: 'border-l-yellow-500',
  danger: 'border-l-destructive',
  muted: 'border-l-muted-foreground'
};

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
    <dt className="text-[13px] leading-5 text-muted-foreground">{label}</dt>
    <dd className="text-right text-[13px] leading-5 text-foreground">
      {value}
    </dd>
  </div>
);

const Network = memo(() => {
  const { t, i18n } = useTranslation('settings');
  const settings = usePublicServerSettings();
  const stunUrls = useMemo(
    () => settings?.webRtcStunUrls ?? [],
    [settings?.webRtcStunUrls]
  );
  const [status, setStatus] = useState<TNetworkStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(
    async (force = false) => {
      setChecking(true);

      try {
        setStatus(await getNetworkStatus(stunUrls, { force }));
      } finally {
        setChecking(false);
      }
    },
    [stunUrls]
  );

  useEffect(() => {
    void check();
  }, [check]);

  const verdict = status ? describeNetworkVerdict(status.reachability) : null;
  const checkedAt = status
    ? new Intl.DateTimeFormat(i18n.language, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(status.at)
    : '\u2014';

  return (
    <SettingsSection
      title={t('networkTitle')}
      description={t('networkDesc')}
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={checking}
          onClick={() => void check(true)}
        >
          <ArrowPathIcon className="size-4" aria-hidden="true" />
          {t('networkRecheck')}
        </Button>
      }
    >
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'max-w-[680px] rounded-[10px] border border-line border-l-4 bg-card p-4',
          TONE_ACCENT[verdict?.tone ?? 'muted']
        )}
      >
        <p className="text-sm leading-5 text-foreground">
          {checking || !verdict ? t('networkChecking') : t(verdict.titleKey)}
        </p>
        {!checking && verdict && (
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            {t(verdict.descriptionKey)}
          </p>
        )}
      </div>

      <dl className="max-w-[680px]">
        <DetailRow
          label={t('networkStunServers')}
          value={status?.servers.join(', ') ?? '\u2014'}
        />
        <DetailRow
          label={t('networkMappedPorts')}
          value={status ? String(status.distinctPorts) : '\u2014'}
        />
        <DetailRow label={t('networkCheckedAt')} value={checkedAt} />
      </dl>

      {status?.usedFallback && (
        <p className="max-w-[680px] text-[13px] leading-5 text-subtle-foreground">
          {t('networkFallbackNote')}
        </p>
      )}
    </SettingsSection>
  );
});

export { Network };
