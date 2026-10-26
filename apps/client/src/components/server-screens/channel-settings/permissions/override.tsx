import { useSettingsForm } from '@/components/server-screens/settings-shell/use-settings-form';
import { requestConfirmation } from '@/features/overlays/actions';
import { useRoleById } from '@/features/server/roles/hooks';
import { useUserById } from '@/features/server/users/hooks';
import { getTRPCClient } from '@/lib/trpc';
import { ChannelPermission, getTrpcError } from '@dodecagon/shared';
import { IconButton, Tooltip } from '@dodecagon/ui';
import { TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChannelPermissionList } from './channel-permission-list';
import type { TChannelPermission } from './types';

type TUserHeaderProps = {
  userId: number;
};

const UserHeader = memo(({ userId }: TUserHeaderProps) => {
  const user = useUserById(userId);

  if (!user) return null;

  return (
    <span className="truncate text-base font-bold leading-5 text-foreground">
      {user.name}
    </span>
  );
});

type TRoleHeaderProps = {
  roleId: number;
};

const RoleHeader = memo(({ roleId }: TRoleHeaderProps) => {
  const role = useRoleById(roleId);

  if (!role) return null;

  return (
    <span className="truncate text-base font-bold leading-5 text-foreground">
      {role.name}
    </span>
  );
});

type TOverrideProps = {
  channelId: number;
  overrideId: string; // Format: "role-{id}" or "user-{id}"
  permissions: TChannelPermission[];
  setSelectedOverrideId: (id: string | undefined) => void;
  refetch: () => Promise<void>;
};

type TOverrideValues = {
  permissions: TChannelPermission[];
};

const Override = memo(
  ({
    channelId,
    overrideId,
    permissions,
    setSelectedOverrideId,
    refetch
  }: TOverrideProps) => {
    const { t } = useTranslation('settings');
    const [overrideType, targetIdStr] = overrideId.split('-');
    const targetId = parseInt(targetIdStr, 10);
    const isRole = overrideType === 'role';

    const onSave = useCallback(
      async (values: TOverrideValues) => {
        const trpc = getTRPCClient();
        const target = isRole ? { roleId: targetId } : { userId: targetId };

        await trpc.channels.updatePermissions.mutate({
          ...target,
          channelId,
          permissions: values.permissions
            .filter((perm) => perm.allow)
            .map((perm) => perm.permission)
        });

        await refetch();
      },
      [channelId, isRole, targetId, refetch]
    );

    const { values, onChange, isDirty } = useSettingsForm<TOverrideValues>({
      initialValues: { permissions },
      onSave,
      successMessage: t('permissionOverrideUpdated'),
      errorMessage: t('failedUpdatePermissionOverride')
    });

    const onDeleteOverride = useCallback(async () => {
      const trpc = getTRPCClient();
      const target = isRole ? { roleId: targetId } : { userId: targetId };

      try {
        await trpc.channels.deletePermissions.mutate({ ...target, channelId });

        toast.success(t('permissionOverrideDeleted'));
        setSelectedOverrideId(undefined);

        await refetch();
      } catch (error) {
        toast.error(getTrpcError(error, t('failedDeletePermissionOverride')));
      }
    }, [channelId, isRole, targetId, setSelectedOverrideId, refetch, t]);

    // closing the editor with unsaved edits asks first, the draft is not lost silently
    const onClose = useCallback(async () => {
      if (isDirty) {
        const choice = await requestConfirmation({
          title: t('discardChangesTitle'),
          message: t('discardChangesMsg'),
          confirmLabel: t('discardChangesBtn'),
          variant: 'danger'
        });

        if (!choice) return;
      }

      setSelectedOverrideId(undefined);
    }, [isDirty, setSelectedOverrideId, t]);

    const onTogglePermission = useCallback(
      (permission: ChannelPermission) => {
        onChange(
          'permissions',
          values.permissions.map((perm) =>
            perm.permission === permission
              ? { ...perm, allow: !perm.allow }
              : perm
          )
        );
      },
      [onChange, values.permissions]
    );

    return (
      <div className="flex min-w-0 flex-1 flex-col gap-4 px-[24px] py-[20px]">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            {isRole ? (
              <RoleHeader roleId={targetId} />
            ) : (
              <UserHeader userId={targetId} />
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs leading-4 text-muted-foreground">
              {isRole ? t('roleOverrideLabel') : t('memberOverrideLabel')}
            </span>
            <Tooltip content={t('deleteOverrideTooltip')}>
              <IconButton
                icon={TrashIcon}
                size="sm"
                variant="destructive"
                onClick={onDeleteOverride}
              />
            </Tooltip>
            <Tooltip content={t('closeEditorTooltip')}>
              <IconButton
                icon={XMarkIcon}
                size="sm"
                variant="ghost"
                onClick={onClose}
              />
            </Tooltip>
          </div>
        </div>

        <ChannelPermissionList
          permissions={values.permissions}
          onTogglePermission={onTogglePermission}
        />
      </div>
    );
  }
);

export { Override };
