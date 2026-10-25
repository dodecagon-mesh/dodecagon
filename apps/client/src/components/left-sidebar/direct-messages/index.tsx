import { UnreadCount } from '@/components/unread-count';
import { UserAvatar } from '@/components/user-avatar';
import { setSelectedDmChannelId } from '@/features/app/actions';
import { setDmsOpen } from '@/features/server/actions';
import { useChannels } from '@/features/server/channels/hooks';
import {
  useActiveDmChannelId,
  useUnreadMessagesCount
} from '@/features/server/hooks';
import { useMessageNavigationIntent } from '@/features/server/messages/use-message-navigation-intent';
import {
  useOwnUserId,
  useUserById,
  useUsers
} from '@/features/server/users/hooks';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  DELETED_USER_IDENTITY_AND_NAME,
  TestId,
  type TDirectMessageConversation
} from '@dodecagon/shared';
import { IconButton, Spinner } from '@dodecagon/ui';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SearchUserDropdown } from './search-user-dropdown';

type TDirectMessageItemProps = {
  dm: TDirectMessageConversation;
  selected: boolean;
  expanded: boolean;
  onSelect: (channelId: number) => void;
};

const DirectMessageItem = memo(
  ({ dm, selected, expanded, onSelect }: TDirectMessageItemProps) => {
    const user = useUserById(dm.userId);
    const unreadCount = useUnreadMessagesCount(dm.channelId);
    const navigationIntent = useMessageNavigationIntent(dm.channelId);
    const handleSelect = useCallback(() => {
      onSelect(dm.channelId);
    }, [dm.channelId, onSelect]);
    const handleAvatarClick = useCallback((event: MouseEvent) => {
      event.stopPropagation();
    }, []);

    if (!user || (!expanded && unreadCount === 0)) {
      return null;
    }

    return (
      <button
        {...navigationIntent}
        data-testid={TestId.DM_ITEM}
        type="button"
        aria-current={selected ? 'page' : undefined}
        className={cn(
          'mt-0.5 flex h-11 w-full items-center gap-3 rounded-[6px] px-2 text-sm leading-5 text-muted-foreground hover:bg-selected hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          unreadCount > 0 && 'font-semibold text-foreground',
          selected && 'bg-selected text-foreground'
        )}
        onClick={handleSelect}
      >
        <span className="shrink-0" onClick={handleAvatarClick}>
          <UserAvatar userId={user.id} className="size-8" showUserPopover />
        </span>
        <span className="truncate flex-1 text-left">{user.name}</span>
        <UnreadCount
          count={unreadCount}
          className="h-[18px] shrink-0 font-bold leading-4"
        />
      </button>
    );
  }
);

const DirectMessages = memo(() => {
  const { t } = useTranslation('sidebar');
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<
    TDirectMessageConversation[]
  >([]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const users = useUsers();
  const channels = useChannels();
  const ownUserId = useOwnUserId();
  const selectedDmChannelId = useActiveDmChannelId();
  const toggleExpanded = useCallback(() => {
    setExpanded((value) => !value);
  }, []);
  const selectConversation = useCallback(
    (channelId: number) => {
      setDmsOpen(true);
      setSelectedDmChannelId(channelId);
      if (!expanded) disclosureRef.current?.focus();
    },
    [expanded]
  );

  const fetchConversations = useCallback(async () => {
    setLoading(true);

    try {
      const trpc = getTRPCClient();
      const items = await trpc.dms.get.query();

      setConversations(items);
    } catch {
      toast.error(t('failedLoadDMs'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchConversations();
  }, [channels.length, fetchConversations]);

  // subscribe to new conversations being opened, when a new conversation is opened we refetch the list of conversations
  useEffect(() => {
    const trpc = getTRPCClient();

    const sub = trpc.dms.onConversationOpen.subscribe(undefined, {
      onData: () => fetchConversations()
    });

    return () => sub.unsubscribe();
  }, [fetchConversations]);

  const usersToStartDm = useMemo(() => {
    const directMessageUserIds = new Set(conversations.map((dm) => dm.userId));

    return users.filter(
      (user) =>
        user.id !== ownUserId &&
        !user.banned &&
        user.name !== DELETED_USER_IDENTITY_AND_NAME &&
        !directMessageUserIds.has(user.id) &&
        user.name.toLowerCase().includes(query.trim().toLowerCase())
    );
  }, [conversations, ownUserId, query, users]);

  const onStartDm = useCallback(
    async (userId: number) => {
      try {
        const trpc = getTRPCClient();
        const result = await trpc.dms.open.mutate({ userId });

        selectConversation(result.channelId);
        await fetchConversations();
      } catch {
        toast.error(t('couldNotOpenDM'));
      }
    },
    [fetchConversations, selectConversation, t]
  );

  const ChevronIcon = expanded ? ChevronDownIcon : ChevronRightIcon;

  // the header shares the control columns of the category headers, the chevron
  // and the action button sit on the same edges
  return (
    <div data-direct-channels className="mx-2 mt-3">
      <div className="flex h-7 items-center gap-1.5 px-2.5">
        <IconButton
          variant="ghost"
          size="xs"
          className="-ml-1.5"
          icon={ChevronIcon}
          onClick={toggleExpanded}
          title={
            expanded ? t('collapseDirectChannels') : t('expandDirectChannels')
          }
        />
        <button
          ref={disclosureRef}
          type="button"
          aria-label={t('directChannels')}
          aria-expanded={expanded}
          onClick={toggleExpanded}
          className="flex h-7 min-w-0 flex-1 items-center rounded-sm text-left text-[13px] font-semibold leading-[18px] tracking-[0.06em] text-muted-foreground uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{t('directChannels')}</span>
        </button>
        <SearchUserDropdown
          query={query}
          setQuery={setQuery}
          usersToStartDm={usersToStartDm}
          onStartDm={onStartDm}
        />
      </div>

      {loading && expanded && conversations.length === 0 && (
        <div className="flex h-24 items-center justify-center">
          <Spinner size="sm" />
        </div>
      )}
      <div>
        {conversations.map((dm) => (
          <DirectMessageItem
            key={dm.channelId}
            dm={dm}
            expanded={expanded}
            selected={selectedDmChannelId === dm.channelId}
            onSelect={selectConversation}
          />
        ))}
        {!loading && expanded && conversations.length === 0 && (
          <div className="px-2 py-4 text-xs text-muted-foreground">
            {t('noDMsYet')}
          </div>
        )}
      </div>
    </div>
  );
});

export { DirectMessages };
