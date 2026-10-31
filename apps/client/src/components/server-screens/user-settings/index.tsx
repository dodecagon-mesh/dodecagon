import { PluginSlotRenderer } from '@/components/plugin-slot-renderer';
import { useCan, useUserSettingsPlugins } from '@/features/server/hooks';
import { Permission, PluginSlot } from '@dodecagon/shared';
import { HeadphonesIcon } from '@dodecagon/ui';
import {
  BellIcon,
  CommandLineIcon,
  CubeIcon,
  GlobeAltIcon,
  KeyIcon,
  PaintBrushIcon,
  UserIcon
} from '@heroicons/react/24/outline';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TServerScreenBaseProps } from '../screens';
import { SettingsShell } from '../settings-shell';
import type { TSettingsEntry } from '../settings-shell/types';
import { Devices } from './devices';
import { Keybindings } from './keybindings';
import { Network } from './network';
import { Notifications } from './notifications';
import { Others } from './others';
import { Password } from './password';
import { Profile } from './profile';

type TUserSettingsProps = TServerScreenBaseProps & { initialEntryId?: string };

const UserSettings = memo(({ close, initialEntryId }: TUserSettingsProps) => {
  const { t } = useTranslation(['settings', 'keybindings']);
  const can = useCan();
  const userSettingsPlugins = useUserSettingsPlugins();

  const entries = useMemo<TSettingsEntry[]>(
    () => [
      {
        id: 'profile',
        label: t('profileTab'),
        icon: UserIcon,
        content: <Profile />
      },
      {
        id: 'devices',
        label: t('devicesTab'),
        icon: HeadphonesIcon,
        content: <Devices />
      },
      {
        id: 'network',
        label: t('networkTab'),
        icon: GlobeAltIcon,
        content: <Network />
      },
      {
        id: 'password',
        label: t('passwordTab'),
        icon: KeyIcon,
        content: <Password />
      },
      {
        id: 'notifications',
        label: t('notificationsTab'),
        icon: BellIcon,
        content: <Notifications />
      },
      {
        id: 'keybindings',
        label: t('keybindings:title'),
        icon: CommandLineIcon,
        content: <Keybindings />
      },
      {
        id: 'others',
        label: t('othersTab'),
        icon: PaintBrushIcon,
        content: <Others />
      }
    ],
    [t]
  );

  // the plugin owns everything inside its entry, so this renders its slot and
  // nothing else
  const pluginEntries = useMemo<TSettingsEntry[]>(() => {
    if (!can(Permission.USE_PLUGINS)) return [];

    return userSettingsPlugins.map((plugin) => ({
      id: `plugin-${plugin.pluginId}`,
      label: plugin.name,
      icon: CubeIcon,
      logo: plugin.logo,
      content: (
        <PluginSlotRenderer
          slotId={PluginSlot.USER_SETTINGS}
          onlyPluginId={plugin.pluginId}
        />
      )
    }));
  }, [can, userSettingsPlugins]);

  return (
    <SettingsShell
      title={t('userSettingsTitle')}
      close={close}
      entries={entries}
      pluginEntries={pluginEntries}
      initialEntryId={initialEntryId}
      groupLabel={t('groupAccount')}
    />
  );
});

export { UserSettings };
