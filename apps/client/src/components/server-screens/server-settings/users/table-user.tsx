import { Dialog } from '@/components/dialogs/dialogs';
import { UserAvatar } from '@/components/user-avatar';
import { setModViewOpen } from '@/features/app/actions';
import { openOverlay } from '@/features/overlays/actions';
import type { TAdminUser } from '@/features/server/admin/hooks';
import { useUserRoles } from '@/features/server/hooks';
import { useOwnUserId, useUserStatus } from '@/features/server/users/hooks';
import { cn } from '@/lib/utils';
import { UserStatus } from '@dodecagon/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@dodecagon/ui';
import {
  EllipsisHorizontalIcon,
  TrashIcon,
  UserCircleIcon
} from '@heroicons/react/24/outline';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

type TTableUserProps = {
  user: TAdminUser;
  refetch?: () => void;
};

const TableUser = memo(({ user, refetch }: TTableUserProps) => {
  const { t } = useTranslation('settings');
  const roles = useUserRoles(user.id);
  const status = useUserStatus(user.id);
  const ownUserId = useOwnUserId();

  const rolesText = useMemo(
    () => roles.map((role) => role.name).join(', '),
    [roles]
  );

  const onModerateClick = useCallback(() => {
    setModViewOpen(true, user.id);
  }, [user.id]);

  const onDeleteClick = useCallback(() => {
    openOverlay({
      kind: 'dialog',
      name: Dialog.DELETE_USER,
      props: { user, refetch }
    });
  }, [user, refetch]);

  return (
    <div className="flex items-center py-[13px] transition-colors hover:bg-muted/30">
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-2">
        <UserAvatar
          userId={user.id}
          className="size-6 flex-shrink-0"
          showUserPopover
        />
        <div
          className="min-w-0 truncate text-sm leading-[18px] text-foreground"
          title={user.name}
        >
          {user.name}
        </div>
      </div>

      <div
        className="w-[180px] shrink-0 truncate text-sm leading-[18px] text-foreground"
        title={rolesText || undefined}
      >
        {rolesText}
      </div>

      <div
        className={cn('w-[90px] shrink-0 text-sm capitalize leading-[18px]', {
          'text-success': status === UserStatus.ONLINE,
          'text-yellow-500': status === UserStatus.IDLE,
          'text-muted-foreground': status === UserStatus.OFFLINE
        })}
      >
        {status}
      </div>

      <div className="flex w-[44px] shrink-0 justify-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              aria-label={t('usersRowActionsLabel', { name: user.name })}
            >
              <EllipsisHorizontalIcon className="size-6" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onModerateClick}>
              <UserCircleIcon className="h-4 w-4" />
              {t('moderateUserAction')}
            </DropdownMenuItem>
            {ownUserId !== user.id && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDeleteClick}
                  className="text-destructive focus:text-destructive"
                >
                  <TrashIcon className="h-4 w-4" />
                  {t('deleteUserAction', { defaultValue: t('deleteBtn') })}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

export { TableUser };
