import { Dialog } from '@/components/dialogs/dialogs';
import { SettingsSection } from '@/components/server-screens/settings-shell/section';
import { openOverlay } from '@/features/overlays/actions';
import { useAdminInvites } from '@/features/server/admin/hooks';
import type { TJoinedInvite } from '@dodecagon/shared';
import { LoadingCard, PaginatedList } from '@dodecagon/ui';
import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { InvitesTable } from './invites-table';

const INVITES_PER_PAGE = 8;

const Invites = memo(() => {
  const { t } = useTranslation('settings');
  const { invites, loading, refetch } = useAdminInvites();

  const searchFilter = useCallback(
    (invite: TJoinedInvite, searchTerm: string) => {
      const query = searchTerm.toLowerCase();

      return (
        invite.code.toLowerCase().includes(query) ||
        invite.creator.name.toLowerCase().includes(query)
      );
    },
    []
  );

  const onCreateInvite = useCallback(
    () =>
      openOverlay({
        kind: 'dialog',
        name: Dialog.CREATE_INVITE,
        props: { refetch }
      }),
    [refetch]
  );

  if (loading) {
    return <LoadingCard className="h-[600px]" />;
  }

  return (
    <PaginatedList
      items={invites}
      itemsPerPage={INVITES_PER_PAGE}
      searchFilter={searchFilter}
    >
      <SettingsSection
        title={t('invitesTitle')}
        description={t('invitesDesc')}
        action={
          <div className="flex items-center gap-3">
            <div className="relative w-[280px]">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-[14px] top-1/2 size-[14px] -translate-y-1/2 text-muted-foreground" />
              <PaginatedList.Search
                placeholder={t('searchInvitesPlaceholder')}
                className="h-[38px] rounded-sm border-control-border bg-input-surface px-[14px] pl-9 text-sm leading-4 placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="button"
              onClick={onCreateInvite}
              aria-label={t('createInviteBtn')}
              title={t('createInviteBtn')}
              className="flex size-[38px] items-center justify-center rounded-[7px] bg-raised text-foreground transition-colors hover:bg-panel focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <PlusIcon className="size-6" strokeWidth={1.5} />
            </button>
          </div>
        }
      >
        <InvitesTable refetch={refetch} />
      </SettingsSection>
    </PaginatedList>
  );
});

export { Invites };
