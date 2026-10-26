import { SettingsSection } from '@/components/server-screens/settings-shell/section';
import { useSettingsForm } from '@/components/server-screens/settings-shell/use-settings-form';
import { requestConfirmation } from '@/features/overlays/actions';
import { getFileUrl } from '@/helpers/get-file-url';
import { getTRPCClient } from '@/lib/trpc';
import type { TJoinedEmoji } from '@dodecagon/shared';
import { Group, IconButton, Input, Tooltip } from '@dodecagon/ui';
import { TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { filesize } from 'filesize';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Emoji } from './emoji';

type TUpdateEmojiProps = {
  selectedEmoji: TJoinedEmoji;
  setSelectedEmojiId: (id: number | undefined) => void;
  refetch: () => Promise<void>;
};

type TEmojiValues = {
  name: string;
};

const UpdateEmoji = memo(
  ({ selectedEmoji, setSelectedEmojiId, refetch }: TUpdateEmojiProps) => {
    const { t } = useTranslation('settings');

    const onSave = useCallback(
      async (values: TEmojiValues) => {
        const trpc = getTRPCClient();

        await trpc.emojis.update.mutate({
          emojiId: selectedEmoji.id,
          name: values.name
        });

        await refetch();
      },
      [selectedEmoji.id, refetch]
    );

    const { r } = useSettingsForm<TEmojiValues>({
      initialValues: { name: selectedEmoji.name },
      onSave,
      successMessage: t('emojiUpdated'),
      errorMessage: t('failedUpdateEmoji')
    });

    const onDeleteEmoji = useCallback(async () => {
      const choice = await requestConfirmation({
        title: t('deleteEmojiTitle'),
        message: t('deleteEmojiMsg'),
        confirmLabel: t('deleteEmojiBtn'),
        variant: 'danger'
      });

      if (!choice) return;

      const trpc = getTRPCClient();

      try {
        await trpc.emojis.delete.mutate({ emojiId: selectedEmoji.id });
        toast.success(t('emojiDeleted'));
        setSelectedEmojiId(undefined);

        await refetch();
      } catch {
        toast.error(t('failedDeleteEmoji'));
      }
    }, [selectedEmoji.id, refetch, setSelectedEmojiId, t]);

    const onClose = useCallback(
      () => setSelectedEmojiId(undefined),
      [setSelectedEmojiId]
    );

    return (
      <SettingsSection
        className="flex-1"
        title={t('editEmojiTitle')}
        action={
          <>
            <Tooltip content={t('deleteEmojiBtn')}>
              <IconButton
                icon={TrashIcon}
                size="sm"
                variant="destructive"
                aria-label={t('deleteEmojiBtn')}
                onClick={onDeleteEmoji}
              />
            </Tooltip>
            <Tooltip content={t('closeEditorTooltip')}>
              <IconButton
                icon={XMarkIcon}
                size="sm"
                variant="ghost"
                aria-label={t('closeEditorTooltip')}
                onClick={onClose}
              />
            </Tooltip>
          </>
        }
      >
        <div className="flex items-center gap-4 rounded-lg bg-muted p-4">
          <Emoji
            src={getFileUrl(selectedEmoji.file)}
            name={selectedEmoji.name}
            className="h-16 w-16"
          />
          <div>
            <div className="font-medium">:{selectedEmoji.name}:</div>
            <div className="text-sm text-muted-foreground">
              {filesize(selectedEmoji.file.size)} • {t('emojiUploadedBy')}{' '}
              {selectedEmoji.user.name}
            </div>
          </div>
        </div>

        <Group
          variant="settings"
          label={t('emojiNameLabel')}
          description={t('emojiNameHint', { name: selectedEmoji.name })}
        >
          <Input placeholder={t('emojiNamePlaceholder')} {...r('name')} />
        </Group>
      </SettingsSection>
    );
  }
);

export { UpdateEmoji };
