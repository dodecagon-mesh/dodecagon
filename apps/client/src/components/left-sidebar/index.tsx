import { SidebarContextMenu } from '@/components/context-menus/sidebar';
import { Dialog } from '@/components/dialogs/dialogs';
import { useShortcutHint } from '@/components/hotkeys-controller/use-shortcut-hint';
import { PluginSlotRenderer } from '@/components/plugin-slot-renderer';
import { ResizableSidebar } from '@/components/resizable-sidebar';
import { openDialog } from '@/features/dialogs/actions';
import { setSelectedChannelId } from '@/features/server/channels/actions';
import {
  usePublicServerSettings,
  useServerName
} from '@/features/server/hooks';
import { LocalStorageKey } from '@/helpers/storage';
import { cn } from '@/lib/utils';
import { PluginSlot, TestId } from '@dodecagon/shared';
import { IconButton, Tooltip } from '@dodecagon/ui';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Categories } from './categories';
import { DirectMessages } from './direct-messages';
import { DmButton } from './direct-messages/dm-button';
import { useFollowVoiceMove, useRestoreLastSelectedChannel } from './hooks';
import { PluginButtons } from './plugin-buttons';
import { ServerSettingsButton } from './server-settings-button';
import { UserControl } from './user-control';
import { VoiceControl } from './voice-control';

const MIN_WIDTH = 252;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 252;

type TLeftSidebarProps = {
  className?: string;
};

const LeftSidebar = memo(({ className }: TLeftSidebarProps) => {
  const { t } = useTranslation('topbar');
  const searchHint = useShortcutHint('search', t('searchContent'));
  const serverName = useServerName();
  const publicSettings = usePublicServerSettings();

  useRestoreLastSelectedChannel();
  useFollowVoiceMove();

  const onSearchClick = useCallback(() => {
    openDialog(Dialog.SEARCH);
  }, []);

  return (
    <ResizableSidebar
      storageKey={LocalStorageKey.LEFT_SIDEBAR_WIDTH}
      minWidth={MIN_WIDTH}
      maxWidth={MAX_WIDTH}
      defaultWidth={DEFAULT_WIDTH}
      edge="right"
      hasBorder={false}
      className={cn(
        'h-full bg-nav select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable=true]]:select-text',
        className
      )}
      data-testid={TestId.LEFT_SIDEBAR}
    >
      <SidebarContextMenu>
        <div className="flex h-12 w-full items-center gap-2 border-b border-line px-4">
          <h2
            className="flex min-w-0 items-center text-base font-semibold text-foreground"
            onClick={() => setSelectedChannelId(undefined)}
            data-testid={TestId.LEFT_SIDEBAR_SERVER_NAME}
          >
            <span className="truncate">{serverName}</span>
          </h2>
          <ServerSettingsButton />
          <div className="ml-auto flex items-center gap-1">
            <PluginSlotRenderer slotId={PluginSlot.TOPBAR_RIGHT} />
            {publicSettings?.enableSearch && (
              <Tooltip content={searchHint}>
                <IconButton
                  onClick={onSearchClick}
                  icon={MagnifyingGlassIcon}
                  variant="ghost"
                  size="sm"
                  className="size-5 p-0 [&_svg]:size-5"
                  aria-label={t('searchContent')}
                  aria-description={searchHint}
                  data-testid={TestId.SEARCH_BUTTON}
                />
              </Tooltip>
            )}
          </div>
        </div>
      </SidebarContextMenu>
      {publicSettings?.directMessagesEnabled && <DmButton />}
      <PluginButtons />
      <SidebarContextMenu>
        <div className="flex-1 overflow-y-auto">
          {publicSettings?.directMessagesEnabled && <DirectMessages />}
          <Categories />
        </div>
      </SidebarContextMenu>
      <div
        data-voice-dock
        className="mx-2 mb-2 flex shrink-0 flex-col overflow-hidden rounded-[10px] border border-line bg-canvas"
      >
        <VoiceControl />
        <UserControl />
      </div>
    </ResizableSidebar>
  );
});

export { LeftSidebar };
