import { useSettingsForm } from '@/components/server-screens/settings-shell/use-settings-form';
import { requestConfirmation } from '@/features/overlays/actions';
import { getTRPCClient } from '@/lib/trpc';
import {
  getTrpcError,
  OWNER_ROLE_ID,
  type Permission,
  STORAGE_MAX_QUOTA_PER_USER,
  STORAGE_MIN_QUOTA_PER_USER,
  type TJoinedRole
} from '@dodecagon/shared';
import {
  Alert,
  AlertDescription,
  Group,
  IconButton,
  Input,
  Separator,
  Switch,
  Tooltip
} from '@dodecagon/ui';
import {
  InformationCircleIcon,
  StarIcon,
  TrashIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import { filesize } from 'filesize';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { QUOTA_BY_USER_PRESETS } from '../storage/presets';
import { StorageSizeControl } from '../storage/storage-size-control';
import { PermissionList } from './permissions-list';

type TRoleValues = {
  name: string;
  color: string;
  permissions: Permission[];
  storageQuotaOverrideEnabled: boolean;
  storageSpaceQuota: number;
};

type TUpdateRoleProps = {
  selectedRole: TJoinedRole;
  setSelectedRoleId: (id: number | undefined) => void;
  refetch: () => void;
};

const UpdateRole = memo(
  ({ selectedRole, setSelectedRoleId, refetch }: TUpdateRoleProps) => {
    const { t } = useTranslation('settings');

    const onSave = useCallback(
      async (values: TRoleValues) => {
        const trpc = getTRPCClient();

        await trpc.roles.update.mutate({ roleId: selectedRole.id, ...values });

        await refetch();
      },
      [selectedRole.id, refetch]
    );

    const { r, onChange, values } = useSettingsForm<TRoleValues>({
      initialValues: {
        name: selectedRole.name,
        color: selectedRole.color,
        permissions: selectedRole.permissions,
        storageQuotaOverrideEnabled: selectedRole.storageQuotaOverrideEnabled,
        storageSpaceQuota: selectedRole.storageSpaceQuota
      },
      onSave,
      successMessage: t('roleUpdated'),
      errorMessage: t('failedUpdateRole')
    });

    const isOwnerRole = selectedRole.id === OWNER_ROLE_ID;
    const storageQuotaLabel = filesize(Number(values.storageSpaceQuota ?? 0), {
      output: 'object',
      standard: 'jedec'
    });

    const onDeleteRole = useCallback(async () => {
      const choice = await requestConfirmation({
        title: t('deleteRoleTitle'),
        message: t('deleteRoleMsg'),
        confirmLabel: t('deleteRoleBtn'),
        variant: 'danger'
      });

      if (!choice) return;

      const trpc = getTRPCClient();

      try {
        await trpc.roles.delete.mutate({ roleId: selectedRole.id });
        toast.success(t('roleDeleted'));
        refetch();
        setSelectedRoleId(undefined);
      } catch {
        toast.error(t('roleDeleteFailed'));
      }
    }, [selectedRole.id, refetch, setSelectedRoleId, t]);

    const onClose = useCallback(
      () => setSelectedRoleId(undefined),
      [setSelectedRoleId]
    );

    const handlePermissionsChange = useCallback(
      (permissions: Permission[]) => onChange('permissions', permissions),
      [onChange]
    );

    const handleStorageOverrideChange = useCallback(
      (checked: boolean) => onChange('storageQuotaOverrideEnabled', checked),
      [onChange]
    );

    const handleStorageQuotaChange = useCallback(
      (value: number) => onChange('storageSpaceQuota', value),
      [onChange]
    );

    const onSetAsDefaultRole = useCallback(async () => {
      const choice = await requestConfirmation({
        title: t('setDefaultRoleTitle'),
        message: t('setDefaultRoleMsg'),
        confirmLabel: t('setDefaultRoleBtn')
      });

      if (!choice) return;

      const trpc = getTRPCClient();

      try {
        await trpc.roles.setDefault.mutate({ roleId: selectedRole.id });

        toast.success(t('defaultRoleUpdated'));
        refetch();
      } catch (error) {
        toast.error(getTrpcError(error, t('failedSetDefaultRole')));
      }
    }, [selectedRole.id, refetch, t]);

    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-base font-bold leading-5 text-foreground">
            {selectedRole.name}
          </h3>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip content={t('setAsDefaultRoleTooltip')}>
              <IconButton
                icon={StarIcon}
                size="sm"
                variant="ghost"
                disabled={selectedRole.isDefault}
                onClick={onSetAsDefaultRole}
              />
            </Tooltip>
            <Tooltip content={t('deleteRoleTooltip')}>
              <IconButton
                icon={TrashIcon}
                size="sm"
                variant="destructive"
                disabled={selectedRole.isPersistent || selectedRole.isDefault}
                onClick={onDeleteRole}
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

        {selectedRole.isDefault && (
          <Alert variant="default">
            <StarIcon />
            <AlertDescription>{t('defaultRoleInfo')}</AlertDescription>
          </Alert>
        )}

        {isOwnerRole && (
          <Alert variant="default">
            <InformationCircleIcon />
            <AlertDescription>{t('ownerRoleInfo')}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-4">
          <Input className="max-w-[430px]" {...r('name')} />
          <input
            aria-label={t('roleColorLabel')}
            className="size-[38px] shrink-0 cursor-pointer rounded-[8px] border border-control-border bg-input-surface p-0.5"
            {...r('color', 'color')}
          />
        </div>

        <PermissionList
          permissions={values.permissions}
          disabled={OWNER_ROLE_ID === selectedRole.id}
          setPermissions={handlePermissionsChange}
        />

        <Separator />

        <Group
          variant="settings"
          label={t('roleStorageOverrideLabel')}
          description={t('roleStorageOverrideDesc')}
        >
          <Switch
            checked={!!values.storageQuotaOverrideEnabled}
            onCheckedChange={handleStorageOverrideChange}
          />
        </Group>

        <Group variant="settings" label={t('roleStorageQuotaLabel')}>
          <StorageSizeControl
            value={Number(values.storageSpaceQuota)}
            max={STORAGE_MAX_QUOTA_PER_USER}
            min={STORAGE_MIN_QUOTA_PER_USER}
            disabled={!values.storageQuotaOverrideEnabled}
            onChange={handleStorageQuotaChange}
            preview={
              Number(values.storageSpaceQuota) === 0 ? (
                t('unlimitedLabel')
              ) : (
                <>
                  {storageQuotaLabel.value} {storageQuotaLabel.unit}
                </>
              )
            }
            presets={QUOTA_BY_USER_PRESETS}
          />
        </Group>
      </div>
    );
  }
);

export { UpdateRole };
