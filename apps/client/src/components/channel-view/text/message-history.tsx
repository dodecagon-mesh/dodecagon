import { UserAvatar } from '@/components/user-avatar';
import { useChannelById } from '@/features/server/channels/hooks';
import {
  registerVirtualMessageList,
  waitForMessageElement
} from '@/features/server/messages/helpers';
import { useUserById } from '@/features/server/users/hooks';
import { cn } from '@/lib/utils';
import type { TJoinedMessage } from '@dodecagon/shared';
import { Spinner } from '@dodecagon/ui';
import {
  ChatBubbleLeftRightIcon,
  HashtagIcon
} from '@heroicons/react/24/outline';
import { useVirtualizer } from '@tanstack/react-virtual';
import { format, isToday } from 'date-fns';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentType,
  type UIEvent
} from 'react';
import { useTranslation } from 'react-i18next';
import { useDmPartner } from './hooks/use-dm-partner';
import {
  buildMessageRows,
  type TMessageHistoryRow
} from './message-history-helpers';
import { MessagesGroup } from './messages-group';

export type TMessageHistoryHandle = {
  scrollToBottom: () => void;
  isAtBottom: () => boolean;
};

type THistorySlotProps = { channelId: number; parentMessageId?: number };

type TMessageHistoryProps = THistorySlotProps & {
  messages: TJoinedMessage[];
  loading: boolean;
  fetching: boolean;
  hasMore: boolean;
  loadMore: () => Promise<unknown>;
  detachedFromPresent?: boolean;
  compact?: boolean;
  onReplyMessageSelect?: (message: TJoinedMessage) => void;
  replyTargetMessageId?: number;
  activeThreadMessageId?: number;
  editingMessageId?: number;
  onEditComplete?: () => void;
  components?: { Footer?: ComponentType<THistorySlotProps> };
};

type THistoryContext = TMessageHistoryProps;

const HistoryHeader = memo(({ context }: { context: THistoryContext }) => {
  const { t } = useTranslation('common');
  const channel = useChannelById(context.channelId);
  const dmPartnerId = useDmPartner(context.channelId, !!channel?.isDm);
  const dmPartner = useUserById(dmPartnerId ?? null);

  if (context.compact) return <div className="h-3" />;
  if (context.hasMore || context.detachedFromPresent || !channel) {
    return null;
  }

  if (channel.isDm) {
    return (
      <div>
        {dmPartner && (
          <div
            data-dm-welcome
            className="flex flex-col items-center gap-3 pb-8 pt-6 text-center"
          >
            <UserAvatar userId={dmPartner.id} className="size-20" />
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold tracking-[-0.01em]">
                {t('dmWelcomeTitle', { name: dmPartner.name })}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('dmWelcomeDescription', { name: dmPartner.name })}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div data-channel-welcome className="flex flex-col gap-[7px] pb-[22px]">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[#3d414b]">
          <HashtagIcon className="size-6" />
        </div>
        <h2 className="text-[27px] leading-[33px] font-bold tracking-[-0.02em]">
          {t('welcomeToChannel', { name: channel.name })}
        </h2>
        <p className="text-[15px] leading-[23px]">{t('channelWelcomeDesc')}</p>
      </div>
    </div>
  );
});

const HistoryFooter = memo(({ context }: { context: THistoryContext }) => {
  const Footer = context.components?.Footer;
  return (
    <div className={context.compact ? 'pb-3' : undefined}>
      {Footer && (
        <Footer
          channelId={context.channelId}
          parentMessageId={context.parentMessageId}
        />
      )}
    </div>
  );
});

const HistoryEmpty = memo(({ context }: { context: THistoryContext }) => {
  const { t } = useTranslation('common');
  if (context.loading)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="sm" />
      </div>
    );
  if (!context.compact || context.fetching) return null;
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground text-sm">
      <ChatBubbleLeftRightIcon className="h-8 w-8 mb-2 opacity-50" />
      <p>{t('noRepliesYet')}</p>
      <p className="text-xs">{t('beFirstToReply')}</p>
    </div>
  );
});

const HistoryRow = memo(
  ({
    row,
    context,
    first,
    last
  }: {
    row: TMessageHistoryRow;
    context: THistoryContext;
    first: boolean;
    last: boolean;
  }) => {
    const { t } = useTranslation('common');
    const date = new Date(row.message.createdAt);
    return (
      <>
        {first && <HistoryHeader context={context} />}
        <div
          className={cn(context.compact && row.startsGroup && !first && 'pt-4')}
        >
          {!context.compact && row.startsDay && (
            <div data-message-date className="flex h-9 items-center gap-[14px]">
              <div className="h-px flex-1 bg-line" />
              <span className="text-[11px] leading-4 font-medium uppercase tracking-[0.06em] text-muted-foreground">
                {isToday(date) ? t('today') : format(date, 'PPP')}
              </span>
              <div className="h-px flex-1 bg-line" />
            </div>
          )}
          <MessagesGroup
            showClockTime
            group={row.group}
            continuation={!row.startsGroup}
            continues={!row.endsGroup}
            compact={context.compact}
            onReplyMessageSelect={context.onReplyMessageSelect}
            replyTargetMessageId={context.replyTargetMessageId}
            activeThreadMessageId={context.activeThreadMessageId}
            editingMessageId={context.editingMessageId}
            onEditComplete={context.onEditComplete}
          />
        </div>
        {last && <HistoryFooter context={context} />}
      </>
    );
  }
);

const estimateMessageHeight = () => 40;
const estimateCompactMessageHeight = () => 34;

export const MessageHistory = memo(
  forwardRef<TMessageHistoryHandle, TMessageHistoryProps>((props, ref) => {
    const {
      messages,
      channelId,
      parentMessageId,
      fetching,
      hasMore,
      loadMore,
      compact = false
    } = props;
    const { t } = useTranslation('common');
    const channel = useChannelById(channelId);
    const containerRef = useRef<HTMLDivElement>(null);
    const initialScrollDone = useRef(false);
    const lastScrollTop = useRef(0);
    const loadingPage = useRef(false);
    const cachedRows = useRef<TMessageHistoryRow[]>([]);
    const rows = useMemo(() => {
      const next = buildMessageRows(messages, cachedRows.current);
      cachedRows.current = next;
      return next;
    }, [messages]);
    const getScrollElement = useCallback(() => containerRef.current, []);
    const getItemKey = useCallback(
      (index: number) => messages[index].id,
      [messages]
    );
    const virtualizer = useVirtualizer({
      count: messages.length,
      getScrollElement,
      estimateSize: compact
        ? estimateCompactMessageHeight
        : estimateMessageHeight,
      getItemKey,
      scrollMargin: compact ? 0 : 24,
      anchorTo: 'end',
      followOnAppend: true,
      // release bottom lock as soon as the reader scrolls into history
      scrollEndThreshold: 1,
      overscan: 8,
      directDomUpdates: true,
      directDomUpdatesMode: 'position'
    });

    // keep the mount guard aligned with the native virtualizer's effect lifetime
    useLayoutEffect(
      () => () => {
        initialScrollDone.current = false;
      },
      []
    );

    useLayoutEffect(() => {
      if (!messages.length || initialScrollDone.current) return;
      initialScrollDone.current = true;
      virtualizer.scrollToEnd();
    }, [messages.length, virtualizer]);

    const scrollToBottom = useCallback(() => {
      virtualizer.scrollToEnd();
    }, [virtualizer]);
    const isAtBottom = useCallback(() => virtualizer.isAtEnd(), [virtualizer]);
    useImperativeHandle(ref, () => ({ scrollToBottom, isAtBottom }), [
      scrollToBottom,
      isAtBottom
    ]);

    const loadOlder = useCallback(async () => {
      if (loadingPage.current || fetching || !hasMore || !messages.length)
        return;
      loadingPage.current = true;
      try {
        await loadMore();
      } finally {
        loadingPage.current = false;
      }
    }, [fetching, hasMore, messages.length, loadMore]);
    const onScroll = useCallback(
      (event: UIEvent<HTMLDivElement>) => {
        const { scrollTop } = event.currentTarget;
        const movingUp = scrollTop < lastScrollTop.current;
        lastScrollTop.current = scrollTop;
        if (movingUp && scrollTop >= 0 && scrollTop <= 80) loadOlder();
      },
      [loadOlder]
    );

    useEffect(() => {
      if (
        initialScrollDone.current &&
        containerRef.current &&
        containerRef.current.scrollTop <= 80
      ) {
        loadOlder();
      }
    }, [loadOlder]);

    const scrollToMessage = useCallback(
      async (messageId: number) => {
        const index = messages.findIndex((message) => message.id === messageId);
        if (index === -1) return null;
        virtualizer.scrollToIndex(index, { align: 'center', behavior: 'auto' });
        return waitForMessageElement(messageId, 3000, parentMessageId);
      },
      [messages, parentMessageId, virtualizer]
    );

    useEffect(
      () =>
        registerVirtualMessageList(channelId, scrollToMessage, parentMessageId),
      [channelId, parentMessageId, scrollToMessage]
    );

    return (
      <div
        ref={containerRef}
        onScroll={onScroll}
        data-messages-container={parentMessageId === undefined ? '' : undefined}
        data-thread-messages={parentMessageId !== undefined ? '' : undefined}
        data-parent-message-id={parentMessageId}
        data-loaded-message-count={messages.length}
        data-oldest-message-id={messages[0]?.id}
        data-newest-message-id={messages[messages.length - 1]?.id}
        tabIndex={0}
        role="region"
        aria-label={compact ? t('thread') : channel?.name}
        className={cn(
          'flex-1 min-h-0 overflow-y-auto overflow-x-hidden',
          compact ? 'px-6' : 'px-4 pt-6 pb-2'
        )}
        style={{ overflowAnchor: 'none' }}
      >
        <div
          className={cn('flex min-h-full flex-col', !compact && 'justify-end')}
        >
          {messages.length > 0 ? (
            <div
              ref={virtualizer.containerRef}
              className="relative w-full shrink-0"
            >
              {virtualizer.getVirtualItems().map((item) => (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute left-0 w-full"
                >
                  <HistoryRow
                    row={rows[item.index]}
                    context={props}
                    first={item.index === 0}
                    last={item.index === messages.length - 1}
                  />
                </div>
              ))}
            </div>
          ) : (
            <>
              <HistoryHeader context={props} />
              <HistoryEmpty context={props} />
              <HistoryFooter context={props} />
            </>
          )}
        </div>
      </div>
    );
  })
);
