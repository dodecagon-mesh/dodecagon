import { RoleBadge } from '@/components/role-badge';
import { requestConfirmation } from '@/features/overlays/actions';
import { getUrlFromServer } from '@/helpers/get-file-url';
import { useDateLocale } from '@/hooks/use-date-locale';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import type { TJoinedInvite } from '@dodecagon/shared';
import { getTrpcError } from '@dodecagon/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@dodecagon/ui';
import {
  ClipboardIcon,
  EllipsisHorizontalIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import { format, formatDistanceToNow } from 'date-fns';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

type TTableInviteProps = {
  invite: TJoinedInvite;
  refetch: () => void;
};

const TableInvite = memo(({ invite, refetch }: TTableInviteProps) => {
  const { t } = useTranslation('settings');
  const dateLocale = useDateLocale();
  const isExpired = invite.expiresAt && invite.expiresAt < Date.now();

  const inviteUrl = useMemo(
    () => `${getUrlFromServer()}/?invite=${invite.code}`,
    [invite.code]
  );

  const handleCopyCode = useCallback(() => {
    navigator.clipboard.writeText(inviteUrl);
    toast.success(t('inviteCopied'));
  }, [inviteUrl, t]);

  const handleDelete = useCallback(async () => {
    const answer = await requestConfirmation({
      title: t('deleteInviteTitle'),
      message: t('deleteInviteMsg'),
      confirmLabel: t('deleteBtn'),
      variant: 'danger'
    });

    if (!answer) return;

    const trpc = getTRPCClient();

    try {
      await trpc.invites.delete.mutate({ inviteId: invite.id });
      toast.success(t('inviteDeletedSuccess'));
      refetch();
    } catch (error) {
      toast.error(getTrpcError(error, t('failedDeleteInvite')));
    }
  }, [invite.id, refetch, t]);

  const usesText = useMemo(() => {
    if (!invite.maxUses) {
      return `${invite.uses} / ∞`;
    }
    return `${invite.uses} / ${invite.maxUses}`;
  }, [invite.uses, invite.maxUses]);

  const expiresText = useMemo(() => {
    if (!invite.expiresAt) {
      return t('inviteNever');
    }
    if (isExpired) {
      return t('inviteExpired');
    }
    return formatDistanceToNow(invite.expiresAt, {
      addSuffix: true,
      locale: dateLocale
    });
  }, [invite.expiresAt, isExpired, t, dateLocale]);

  return (
    <div className="flex items-center py-[13px] transition-colors hover:bg-muted/30">
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-2">
        <span
          className="truncate text-sm leading-[18px] text-foreground"
          title={inviteUrl}
        >
          {inviteUrl}
        </span>
        <Button
          variant="ghost"
          className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          aria-label={t('copyInviteLink')}
          onClick={handleCopyCode}
        >
          <ClipboardIcon className="size-4" />
        </Button>
      </div>

      <div className="flex w-[180px] shrink-0 items-center">
        {invite.role ? (
          <RoleBadge role={invite.role} />
        ) : (
          <span className="text-sm leading-[18px] text-muted-foreground">
            {t('inviteDefault')}
          </span>
        )}
      </div>

      <div className="w-[160px] shrink-0">
        <span
          className={cn('text-sm leading-[18px] text-muted-foreground', {
            'text-destructive': isExpired
          })}
          title={
            invite.expiresAt
              ? format(invite.expiresAt, 'PPP p', { locale: dateLocale })
              : undefined
          }
        >
          {expiresText}
        </span>
      </div>

      <div className="w-[120px] shrink-0 text-sm leading-[18px] text-muted-foreground">
        <span className="truncate">{usesText}</span>
      </div>

      <div className="flex w-[50px] shrink-0 justify-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              aria-label={t('invitesRowActionsLabel', { code: invite.code })}
            >
              <EllipsisHorizontalIcon className="size-6" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleCopyCode}>
              <ClipboardIcon className="h-4 w-4" />
              {t('copyInviteLink')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleDelete}
              className="text-destructive focus:text-destructive"
            >
              <TrashIcon className="h-4 w-4" />
              {t('deleteBtn')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

export { TableInvite };
