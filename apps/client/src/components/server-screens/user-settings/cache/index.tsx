import { SettingsRow } from '@/components/server-screens/settings-shell/row';
import { SettingsSection } from '@/components/server-screens/settings-shell/section';
import {
  clearMediaCache,
  getMediaCacheStats,
  isMediaCacheSupported
} from '@/helpers/media-cache';
import { Button } from '@dodecagon/ui';
import { filesize } from 'filesize';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

type TMediaCacheStats = {
  entries: number;
  bytes: number;
};

const Cache = memo(() => {
  const { t } = useTranslation('settings');
  const [stats, setStats] = useState<TMediaCacheStats>({
    entries: 0,
    bytes: 0
  });
  const [clearing, setClearing] = useState(false);
  const supported = isMediaCacheSupported();

  const loadStats = useCallback(async () => {
    setStats(await getMediaCacheStats());
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleClear = useCallback(async () => {
    setClearing(true);

    try {
      await clearMediaCache();
      toast.success(t('cacheCleared'));
      await loadStats();
    } catch {
      toast.error(t('cacheClearFailed'));
    } finally {
      setClearing(false);
    }
  }, [loadStats, t]);

  const size = filesize(stats.bytes, { standard: 'jedec' });

  return (
    <SettingsSection title={t('cacheTitle')} description={t('cacheDesc')}>
      <div className="flex max-w-[1040px] flex-col">
        <SettingsRow
          label={t('mediaCacheLabel')}
          description={t('mediaCacheDesc')}
          className="border-b-0"
        >
          <span className="text-sm text-muted-foreground">
            {t('mediaCacheUsage', { size })}
          </span>
          {supported ? (
            <Button
              variant="secondary"
              disabled={clearing}
              onClick={handleClear}
            >
              {t('clearCache')}
            </Button>
          ) : (
            <span className="max-w-[320px] text-right text-[13px] leading-4 text-subtle-foreground">
              {t('cacheUnavailable')}
            </span>
          )}
        </SettingsRow>
      </div>
    </SettingsSection>
  );
});

export { Cache };
