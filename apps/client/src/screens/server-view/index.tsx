import { ServerHotkeysController } from '@/components/hotkeys-controller/server-hotkeys-controller';
import { LeftSidebar } from '@/components/left-sidebar';
import { ModViewSheet } from '@/components/mod-view-sheet';
import { Protect } from '@/components/protect';
import { RightSidebar } from '@/components/right-sidebar';
import { ThreadSidebar } from '@/components/thread-sidebar';
import { VoiceChatSidebar } from '@/components/voice-chat-sidebar';
import { VoiceProvider } from '@/components/voice-provider';
import {
  setMembersPanelOpen,
  toggleMembersPanel
} from '@/features/app/actions';
import {
  useMembersPanelOpen,
  useSelectedDmChannelId,
  useThreadSidebar
} from '@/features/app/hooks';
import { useIsServerScreenOpen } from '@/features/overlays/hooks';
import { setDmsOpen } from '@/features/server/actions';
import { setSelectedChannelId } from '@/features/server/channels/actions';
import { useDmsOpen, usePublicServerSettings } from '@/features/server/hooks';
import { useSwipeGestures } from '@/hooks/use-swipe-gestures';
import { cn } from '@/lib/utils';
import { Permission, TestId } from '@dodecagon/shared';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ContentWrapper } from './content-wrapper';
import { PreventBrowser } from './prevent-browser';

const ServerView = memo(() => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileUsersOpen, setIsMobileUsersOpen] = useState(false);
  const membersPanelOpen = useMembersPanelOpen();
  const dmsOpen = useDmsOpen();
  const selectedDmChannelId = useSelectedDmChannelId();
  const publicSettings = usePublicServerSettings();
  const previousServerChannelIdRef = useRef<number | undefined>(undefined);
  const { isOpen: isThreadSidebarOpen } = useThreadSidebar();

  const handleDesktopRightSidebarToggle = useCallback(() => {
    toggleMembersPanel();
  }, []);

  const handleCloseRightSidebar = useCallback(() => {
    setIsMobileUsersOpen(false);
    setMembersPanelOpen(false);
  }, []);

  const handleMembersShortcut = useCallback(() => {
    // use the same lg breakpoint as the desktop sidebar layout
    if (window.matchMedia('(min-width: 64rem)').matches) {
      handleDesktopRightSidebarToggle();
      return;
    }

    setIsMobileMenuOpen(false);
    setIsMobileUsersOpen((prev) => !prev);
  }, [handleDesktopRightSidebarToggle]);

  const handleSwipeRight = useCallback(() => {
    if (isMobileMenuOpen || isMobileUsersOpen) {
      setIsMobileMenuOpen(false);
      setIsMobileUsersOpen(false);
      return;
    }

    setIsMobileMenuOpen(true);
  }, [isMobileMenuOpen, isMobileUsersOpen]);

  const handleSwipeLeft = useCallback(() => {
    if (isMobileMenuOpen || isMobileUsersOpen) {
      setIsMobileMenuOpen(false);
      setIsMobileUsersOpen(false);

      return;
    }

    setIsMobileUsersOpen(true);
  }, [isMobileMenuOpen, isMobileUsersOpen]);

  const swipeHandlers = useSwipeGestures({
    onSwipeRight: handleSwipeRight,
    onSwipeLeft: handleSwipeLeft
  });

  useEffect(() => {
    if (publicSettings?.directMessagesEnabled === false && dmsOpen) {
      setDmsOpen(false);

      if (previousServerChannelIdRef.current) {
        setSelectedChannelId(previousServerChannelIdRef.current);
      }
    }
  }, [publicSettings?.directMessagesEnabled, dmsOpen]);
  const isServerScreenOpen = useIsServerScreenOpen();

  useEffect(() => {
    if (!isServerScreenOpen) return;

    setIsMobileMenuOpen(false);
    setIsMobileUsersOpen(false);
  }, [isServerScreenOpen]);

  return (
    <VoiceProvider>
      <ServerHotkeysController onToggleMembers={handleMembersShortcut} />
      <div
        data-testid={TestId.SERVER_VIEW}
        className="flex h-dvh flex-col bg-background text-foreground"
        {...swipeHandlers}
      >
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <PreventBrowser />

          {isMobileMenuOpen && (
            <div
              className="md:hidden fixed inset-0 bg-black/50 z-30"
              onClick={() => setIsMobileMenuOpen(false)}
            />
          )}

          {isMobileUsersOpen && (
            <div
              className="lg:hidden fixed inset-0 bg-black/50 z-30"
              onClick={() => setIsMobileUsersOpen(false)}
            />
          )}

          <LeftSidebar
            className={cn(
              'md:relative md:flex fixed inset-0 left-0 h-full z-40 md:z-0 transition-transform duration-300 ease-in-out',
              isMobileMenuOpen
                ? 'translate-x-0'
                : '-translate-x-full md:translate-x-0'
            )}
          />

          <ContentWrapper
            isDmMode={dmsOpen}
            selectedDmChannelId={selectedDmChannelId}
            onToggleRightSidebar={handleDesktopRightSidebarToggle}
            isRightSidebarOpen={membersPanelOpen}
          />

          <VoiceChatSidebar />

          <ThreadSidebar isOpen={isThreadSidebarOpen} />

          <RightSidebar
            className={cn(
              'fixed top-0 bottom-0 right-0 h-full z-40',
              'lg:relative lg:z-0',
              isMobileUsersOpen
                ? 'translate-x-0 lg:translate-x-0'
                : 'translate-x-full lg:translate-x-0'
            )}
            isOpen={isMobileUsersOpen || membersPanelOpen}
            onClose={handleCloseRightSidebar}
          />

          <Protect permission={Permission.MANAGE_USERS}>
            <ModViewSheet />
          </Protect>
        </div>
      </div>
    </VoiceProvider>
  );
});

export { ServerView };
