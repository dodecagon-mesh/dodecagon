import { Dialog } from '@/components/dialogs/dialogs';
import { openOverlay } from '@/features/overlays/actions';
import { useDateLocale } from '@/hooks/use-date-locale';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  getTrpcError,
  PLUGIN_SDK_VERSION,
  type TMarketplaceEntry
} from '@dodecagon/shared';
import { Badge, Button, IconButton, Tooltip } from '@dodecagon/ui';
import {
  ArrowDownTrayIcon,
  CalendarIcon,
  CheckBadgeIcon,
  ChevronDownIcon,
  CubeIcon,
  PlusIcon,
  UserIcon
} from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import semver from 'semver';
import { toast } from 'sonner';
import { ImageWithFallback } from './image-with-fallback';
import { MarketplaceScreenshots } from './marketplace-screenshots';

type TMarketplaceItemProps = {
  entry: TMarketplaceEntry;
  isInstalled: boolean;
  installedVersion?: string;
  refetchInstalled: () => Promise<void>;
};

const MarketplaceItem = memo(
  ({
    entry,
    isInstalled,
    installedVersion,
    refetchInstalled
  }: TMarketplaceItemProps) => {
    const { t } = useTranslation('settings');
    const dateLocale = useDateLocale();
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const { plugin, versions } = entry;
    const latestVersion = versions[0];

    const isNewerVersion = useCallback((next: string, current: string) => {
      const nextVersion = semver.coerce(next);
      const currentVersion = semver.coerce(current);

      if (!nextVersion || !currentVersion) return false;

      return semver.gt(nextVersion, currentVersion);
    }, []);

    const latestCompatibleVersion = useMemo(() => {
      const compatible = versions.filter((version) => {
        return version.sdkVersion === PLUGIN_SDK_VERSION;
      });

      if (compatible.length === 0) return null;

      return compatible.reduce((best, next) =>
        isNewerVersion(next.version, best.version) ? next : best
      );
    }, [versions, isNewerVersion]);

    const sdkVersion =
      latestCompatibleVersion?.sdkVersion ?? latestVersion?.sdkVersion;

    const sdkCompatible = sdkVersion === PLUGIN_SDK_VERSION;

    // the badge alone does not say what is wrong, and the number a plugin needs
    // is the only thing that tells an admin whether to wait for an update
    const sdkTooltip = sdkCompatible
      ? t('marketplaceSdkCompatibleTooltip', { version: PLUGIN_SDK_VERSION })
      : t('marketplaceSdkIncompatibleTooltip', {
          required: sdkVersion,
          current: PLUGIN_SDK_VERSION
        });

    const updateAvailable = useMemo(() => {
      if (!installedVersion || !latestCompatibleVersion) return false;

      return isNewerVersion(latestCompatibleVersion.version, installedVersion);
    }, [installedVersion, latestCompatibleVersion, isNewerVersion]);

    const releaseDate = useMemo(() => {
      return {
        short: format(latestVersion.timestamp ?? 0, 'PPP', {
          locale: dateLocale
        }),
        full: format(latestVersion.timestamp ?? 0, 'PPP p', {
          locale: dateLocale
        })
      };
    }, [dateLocale, latestVersion?.timestamp]);

    const performInstall = useCallback(async () => {
      if (!latestVersion) return;

      const trpc = getTRPCClient();

      try {
        setInstallingId(plugin.id);

        await trpc.plugins.install.mutate({
          pluginId: plugin.id,
          version: latestVersion.version
        });

        toast.success(t('marketplaceInstallSuccess', { name: plugin.name }));

        await refetchInstalled();
      } catch (error) {
        toast.error(getTrpcError(error, t('marketplaceInstallError')));
      } finally {
        setInstallingId(null);
      }
    }, [plugin.id, latestVersion, t, plugin.name, refetchInstalled]);

    const performUpdate = useCallback(async () => {
      if (!latestCompatibleVersion) return;

      const trpc = getTRPCClient();

      try {
        setUpdatingId(plugin.id);

        await trpc.plugins.update.mutate({
          pluginId: plugin.id,
          version: latestCompatibleVersion.version
        });

        await refetchInstalled();
      } catch (error) {
        toast.error(getTrpcError(error, t('marketplaceUpdateError')));
      } finally {
        setUpdatingId(null);
      }
    }, [latestCompatibleVersion, plugin.id, t, refetchInstalled]);

    const onInstallClick = useCallback(() => {
      openOverlay({
        kind: 'dialog',
        name: Dialog.PLUGIN_INSTALL_CONFIRM,
        props: {
          pluginName: plugin.name,
          onConfirm: performInstall
        }
      });
    }, [plugin.name, performInstall]);

    const onUpdateClick = useCallback(() => {
      openOverlay({
        kind: 'dialog',
        name: Dialog.PLUGIN_INSTALL_CONFIRM,
        props: {
          pluginName: plugin.name,
          onConfirm: performUpdate
        }
      });
    }, [plugin.name, performUpdate]);

    return (
      <div className="flex flex-col overflow-hidden rounded-[8px] border border-control-border bg-input-surface">
        <div className="flex items-center gap-[15px] px-[18px] py-[14px]">
          <div className="flex size-[44px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-raised">
            {plugin.logo ? (
              <ImageWithFallback
                src={plugin.logo}
                alt={`${plugin.name} logo`}
                className="size-full object-cover"
                iconFallback={
                  <CubeIcon className="size-6 text-muted-foreground" />
                }
              />
            ) : (
              <CubeIcon className="size-6 text-muted-foreground" />
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-[14px] font-semibold leading-[20px] text-foreground">
                {plugin.name}
              </h3>
              {plugin.verified && (
                <Tooltip content={t('marketplaceVerifiedTooltip')}>
                  <span
                    role="img"
                    aria-label={t('marketplaceVerified')}
                    className="flex shrink-0 items-center text-accent-text"
                  >
                    <CheckBadgeIcon className="size-4" />
                  </span>
                </Tooltip>
              )}
              <Tooltip content={sdkTooltip}>
                <Badge
                  variant={sdkCompatible ? 'secondary' : 'destructive'}
                  className="shrink-0 text-[11px]"
                >
                  {sdkCompatible
                    ? t('marketplaceSdkCompatible')
                    : t('marketplaceSdkIncompatible')}
                </Badge>
              </Tooltip>
            </div>
            <p className="line-clamp-2 text-[12px] leading-[17px] text-muted-foreground">
              {plugin.description}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {isInstalled && (
              <span className="text-[12px] leading-4 text-muted-foreground">
                {t('marketplaceInstalledBadge')}
              </span>
            )}
            {updateAvailable ? (
              <Button
                size="sm"
                className="h-8 rounded-[8px] px-[10px] text-[12px]"
                onClick={onUpdateClick}
                disabled={updatingId === plugin.id || !sdkCompatible}
              >
                <ArrowDownTrayIcon className="size-4" />
                {t('marketplaceUpdateBtn')}
              </Button>
            ) : !isInstalled ? (
              <Button
                size="sm"
                className="h-8 rounded-[8px] px-[10px] text-[12px]"
                onClick={onInstallClick}
                disabled={installingId === plugin.id || !sdkCompatible}
              >
                <PlusIcon className="size-4" />
                {t('marketplaceInstallBtn')}
              </Button>
            ) : null}
            <Tooltip content={t('marketplaceDetailsTooltip')}>
              <IconButton
                icon={ChevronDownIcon}
                variant="ghost"
                size="sm"
                aria-label={t('marketplaceDetailsTooltip')}
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((open) => !open)}
                className={cn(detailsOpen && 'rotate-180')}
              />
            </Tooltip>
          </div>
        </div>

        {detailsOpen && (
          <div className="flex flex-col gap-3 border-t border-line px-[18px] py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] leading-4 text-muted-foreground">
              {latestVersion && (
                <span className="font-mono">v{latestVersion.version}</span>
              )}
              <span
                className="flex items-center gap-1"
                title={t('marketplaceReleasedOn', { date: releaseDate.full })}
              >
                <CalendarIcon className="size-3.5" />
                <span>
                  {t('marketplaceReleasedOn', { date: releaseDate.short })}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <UserIcon className="size-3.5" />
                <span>{plugin.author}</span>
              </span>
              {plugin.homepage && (
                <a
                  href={plugin.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="underline transition-colors hover:text-accent-text"
                >
                  {plugin.homepage}
                </a>
              )}
            </div>

            {plugin.tags && plugin.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {plugin.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[11px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {plugin.screenshots && plugin.screenshots.length > 0 && (
              <MarketplaceScreenshots
                pluginId={plugin.id}
                pluginName={plugin.name}
                screenshots={plugin.screenshots}
              />
            )}
          </div>
        )}
      </div>
    );
  }
);

export { MarketplaceItem };
