import { requestConfirmation } from '@/features/overlays/actions';
import { usePluginsEnabled } from '@/features/server/hooks';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import type { TPluginInfo } from '@dodecagon/shared';
import { getTrpcError, TestId } from '@dodecagon/shared';
import {
  Button,
  IconButton,
  LoadingCard,
  Switch,
  Tooltip
} from '@dodecagon/ui';
import {
  ArrowPathIcon,
  CubeIcon,
  ExclamationCircleIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { StatePanel } from '../../settings-shell/state-panel';
import { ListWithSeparators } from './list-with-separators';
import { ImageWithFallback } from './marketplace/image-with-fallback';

type TPluginItemProps = {
  plugin: TPluginInfo;
  onToggle: (pluginId: string, enabled: boolean) => Promise<void>;
  onRemove: (pluginId: string) => Promise<void>;
};

const PluginItem = memo(({ plugin, onToggle, onRemove }: TPluginItemProps) => {
  const { t } = useTranslation('settings');
  const [isToggling, setIsToggling] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const handleToggle = useCallback(
    async (checked: boolean) => {
      setIsToggling(true);
      try {
        await onToggle(plugin.id, checked);
      } finally {
        setIsToggling(false);
      }
    },
    [plugin.id, onToggle]
  );

  const handleRemove = useCallback(async () => {
    const confirmed = await requestConfirmation({
      title: t('removePluginTitle'),
      message: t('removePluginConfirm', { name: plugin.name }),
      confirmLabel: t('removeBtn'),
      variant: 'danger'
    });

    if (!confirmed) return;

    setIsRemoving(true);

    try {
      await onRemove(plugin.id);
    } finally {
      setIsRemoving(false);
    }
  }, [plugin.id, plugin.name, onRemove, t]);

  return (
    <div
      data-testid={TestId.INSTALLED_PLUGIN_ITEM}
      className="flex w-full items-center gap-[14px] py-[14px]"
    >
      <div className="flex size-[42px] shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-raised">
        {plugin.logo ? (
          <ImageWithFallback
            src={plugin.logo}
            alt={`${plugin.name} logo`}
            className="size-full object-cover"
            iconFallback={<CubeIcon className="size-6 text-muted-foreground" />}
          />
        ) : (
          <CubeIcon className="size-6 text-muted-foreground" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <h3 className="truncate text-[15px] font-semibold leading-[18px] text-foreground">
          {plugin.name}
        </h3>
        <p className="truncate text-[13px] leading-4 text-muted-foreground">
          {plugin.description}
        </p>
        {plugin.loadError && (
          <p className="text-xs leading-4 text-destructive">
            {plugin.loadError}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span
          className={
            plugin.loadError
              ? 'text-[13px] leading-4 text-destructive'
              : plugin.enabled
                ? 'text-[13px] leading-4 text-success'
                : 'text-[13px] leading-4 text-muted-foreground'
          }
        >
          {plugin.loadError
            ? t('errorBadge')
            : plugin.enabled
              ? t('enabledBadge')
              : t('disabledBadge')}
        </span>
        <Switch
          aria-label={plugin.name}
          checked={plugin.enabled}
          onCheckedChange={handleToggle}
          disabled={isToggling}
        />
        <Tooltip content={t('removeBtn')}>
          <IconButton
            icon={TrashIcon}
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={isRemoving}
          />
        </Tooltip>
      </div>
    </div>
  );
});

type TInstalledPluginsProps = {
  plugins: TPluginInfo[];
  loading: boolean;
  refetch: () => Promise<void>;
};

const InstalledPlugins = memo(
  ({ plugins, loading, refetch }: TInstalledPluginsProps) => {
    const { t } = useTranslation('settings');
    const enabled = usePluginsEnabled();
    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefresh = useCallback(async () => {
      setIsRefreshing(true);
      try {
        await refetch();
        toast.success(t('pluginsRefreshed'));
      } catch (error) {
        toast.error(getTrpcError(error, t('failedRefreshPlugins')));
      } finally {
        setIsRefreshing(false);
      }
    }, [refetch, t]);

    const handleToggle = useCallback(
      async (pluginId: string, enabled: boolean) => {
        const trpc = getTRPCClient();

        try {
          await trpc.plugins.toggle.mutate({ pluginId, enabled });
          toast.success(enabled ? t('pluginEnabled') : t('pluginDisabled'));
        } catch (error) {
          toast.error(getTrpcError(error, t('failedTogglePlugin')));
        } finally {
          refetch();
        }
      },
      [refetch, t]
    );

    const handleRemove = useCallback(
      async (pluginId: string) => {
        const trpc = getTRPCClient();

        try {
          await trpc.plugins.remove.mutate({ pluginId });
          toast.success(t('pluginRemoved'));
        } catch (error) {
          toast.error(getTrpcError(error, t('failedRemovePlugin')));
        } finally {
          refetch();
        }
      },
      [refetch, t]
    );

    if (loading) {
      return <LoadingCard className="h-[600px]" />;
    }

    let content = (
      <StatePanel
        icon={ExclamationCircleIcon}
        title={t('pluginsDisabledTitle')}
        description={t('pluginsDisabledDesc')}
      />
    );

    if (enabled && plugins.length === 0) {
      content = (
        <StatePanel
          icon={CubeIcon}
          title={t('noPluginsTitle')}
          description={t('noPluginsDesc')}
        />
      );
    } else if (enabled) {
      content = (
        <ListWithSeparators
          className="divide-y divide-line"
          items={plugins}
          getKey={(plugin) => plugin.id}
          renderItem={(plugin) => (
            <PluginItem
              plugin={plugin}
              onToggle={handleToggle}
              onRemove={handleRemove}
            />
          )}
        />
      );
    }

    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing || loading || !enabled}
          >
            <ArrowPathIcon
              className={cn('h-4 w-4', isRefreshing && 'animate-spin')}
            />
            {t('refreshBtn')}
          </Button>
        </div>
        {content}
      </div>
    );
  }
);

export { InstalledPlugins };
