import { ServerScreen } from '@/components/server-screens/screens';
import { openOverlay } from '@/features/overlays/actions';
import { useCan } from '@/features/server/hooks';
import { Permission, TestId } from '@dodecagon/shared';
import { IconButton, Tooltip } from '@dodecagon/ui';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const SERVER_SETTINGS_PERMISSIONS = [
  Permission.MANAGE_SETTINGS,
  Permission.MANAGE_ROLES,
  Permission.MANAGE_EMOJIS,
  Permission.MANAGE_STORAGE,
  Permission.MANAGE_USERS,
  Permission.MANAGE_INVITES,
  Permission.MANAGE_UPDATES
];

const ServerSettingsButton = memo(() => {
  const { t } = useTranslation('sidebar');
  const can = useCan();

  const onClick = useCallback(() => {
    openOverlay({ kind: 'serverScreen', name: ServerScreen.SERVER_SETTINGS });
  }, []);

  if (!can(SERVER_SETTINGS_PERMISSIONS)) {
    return null;
  }

  return (
    <Tooltip content={t('serverSettings')}>
      <IconButton
        data-testid={TestId.SERVER_SETTINGS_BUTTON}
        onClick={onClick}
        icon={Cog6ToothIcon}
        variant="ghost"
        size="sm"
        className="size-5 p-0 [&_svg]:size-5"
        aria-label={t('serverSettings')}
        title={t('serverSettings')}
      />
    </Tooltip>
  );
});

export { ServerSettingsButton };
