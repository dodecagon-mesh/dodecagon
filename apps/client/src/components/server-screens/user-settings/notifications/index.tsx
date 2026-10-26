import { Dialog } from '@/components/dialogs/dialogs';
import { SettingsSection } from '@/components/server-screens/settings-shell/section';
import { useSettingsForm } from '@/components/server-screens/settings-shell/use-settings-form';
import {
  setBrowserNotifications,
  setBrowserNotificationsForDms,
  setBrowserNotificationsForMentions,
  setBrowserNotificationsForReplies,
  setMessageSentSound,
  setNotificationSounds
} from '@/features/app/actions';
import {
  useBrowserNotifications,
  useBrowserNotificationsForDms,
  useBrowserNotificationsForMentions,
  useBrowserNotificationsForReplies,
  useMessageSentSound,
  useNotificationSounds
} from '@/features/app/hooks';
import { openOverlay } from '@/features/overlays/actions';
import { Button, Switch } from '@dodecagon/ui';
import { memo, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

type TNotificationsValues = {
  all: boolean;
  mentions: boolean;
  dms: boolean;
  replies: boolean;
  sounds: boolean;
  sentSound: boolean;
};

type TNotificationRowProps = {
  label: string;
  description?: string;
  children: ReactNode;
};

// Paper · Notifications: a compact row keeps the label on the left and the
// switch on the right, with the hint one step smaller than the label
const NotificationRow = memo(
  ({ label, description, children }: TNotificationRowProps) => {
    return (
      <div className="flex w-full items-center justify-between gap-4 border-b border-line py-[15px]">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm leading-[18px] text-foreground">
            {label}
          </span>
          {description && (
            <span className="text-[13px] leading-4 text-muted-foreground">
              {description}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    );
  }
);

NotificationRow.displayName = 'NotificationRow';

const Notifications = memo(() => {
  const { t } = useTranslation('settings');
  const all = useBrowserNotifications();
  const mentions = useBrowserNotificationsForMentions();
  const dms = useBrowserNotificationsForDms();
  const replies = useBrowserNotificationsForReplies();
  const sounds = useNotificationSounds();
  const sentSound = useMessageSentSound();

  const onSave = useCallback(async (values: TNotificationsValues) => {
    // TODO: refactor this later
    setBrowserNotifications(values.all);
    setBrowserNotificationsForMentions(values.mentions);
    setBrowserNotificationsForDms(values.dms);
    setBrowserNotificationsForReplies(values.replies);
    setNotificationSounds(values.sounds);
    setMessageSentSound(values.sentSound);
  }, []);

  const { values, onChange } = useSettingsForm<TNotificationsValues>({
    initialValues: { all, mentions, dms, replies, sounds, sentSound },
    onSave,
    successMessage: t('notificationsUpdated'),
    errorMessage: t('failedUpdateNotifications')
  });

  const handleAllChange = useCallback(
    (value: boolean) => onChange('all', value),
    [onChange]
  );
  const handleMentionsChange = useCallback(
    (value: boolean) => onChange('mentions', value),
    [onChange]
  );
  const handleDmsChange = useCallback(
    (value: boolean) => onChange('dms', value),
    [onChange]
  );
  const handleRepliesChange = useCallback(
    (value: boolean) => onChange('replies', value),
    [onChange]
  );
  const handleSoundsChange = useCallback(
    (value: boolean) => onChange('sounds', value),
    [onChange]
  );
  const handleSentSoundChange = useCallback(
    (value: boolean) => onChange('sentSound', value),
    [onChange]
  );

  const handleOpenSoundSettings = useCallback(() => {
    openOverlay({ kind: 'dialog', name: Dialog.SOUND_SETTINGS });
  }, []);

  return (
    <SettingsSection
      title={t('notificationsTitle')}
      description={t('notificationsDesc')}
    >
      <div className="flex max-w-[1040px] flex-col">
        <NotificationRow
          label={t('allMessagesLabel')}
          description={t('allMessagesDesc')}
        >
          <Switch
            aria-label={t('allMessagesLabel')}
            checked={values.all}
            onCheckedChange={handleAllChange}
          />
        </NotificationRow>
        <NotificationRow
          label={t('mentionsOnlyLabel')}
          description={t('mentionsOnlyDesc')}
        >
          <Switch
            aria-label={t('mentionsOnlyLabel')}
            checked={values.mentions}
            onCheckedChange={handleMentionsChange}
          />
        </NotificationRow>
        <NotificationRow
          label={t('dmNotificationsLabel')}
          description={t('dmNotificationsDesc')}
        >
          <Switch
            aria-label={t('dmNotificationsLabel')}
            checked={values.dms}
            onCheckedChange={handleDmsChange}
          />
        </NotificationRow>
        <NotificationRow
          label={t('repliesNotificationsLabel')}
          description={t('repliesNotificationsDesc')}
        >
          <Switch
            aria-label={t('repliesNotificationsLabel')}
            checked={values.replies}
            onCheckedChange={handleRepliesChange}
          />
        </NotificationRow>
        <NotificationRow label={t('soundsLabel')} description={t('soundsDesc')}>
          <Switch
            aria-label={t('soundsLabel')}
            checked={values.sounds}
            onCheckedChange={handleSoundsChange}
          />
        </NotificationRow>
        <NotificationRow
          label={t('messageSentSoundLabel')}
          description={t('messageSentSoundDesc')}
        >
          <Switch
            aria-label={t('messageSentSoundLabel')}
            checked={values.sentSound}
            disabled={!values.sounds}
            onCheckedChange={handleSentSoundChange}
          />
        </NotificationRow>
        <NotificationRow
          label={t('soundSettingsLabel')}
          description={t('soundSettingsDesc')}
        >
          <Button variant="secondary" onClick={handleOpenSoundSettings}>
            {t('soundSettingsOpenBtn')}
          </Button>
        </NotificationRow>
      </div>
    </SettingsSection>
  );
});

export { Notifications };
