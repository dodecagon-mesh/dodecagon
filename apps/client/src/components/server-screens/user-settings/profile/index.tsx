import { TextInputDialog } from '@/components/dialogs/text-input';
import { SettingsSection } from '@/components/server-screens/settings-shell/section';
import { useSettingsForm } from '@/components/server-screens/settings-shell/use-settings-form';
import { UserStatusBadge } from '@/components/user-status';
import { useOwnPublicUser } from '@/features/server/users/hooks';
import { getFileUrl } from '@/helpers/get-file-url';
import { getInitialsFromName } from '@/helpers/get-initials-from-name';
import { useDateLocale } from '@/hooks/use-date-locale';
import { usePickImage, type TPickedImage } from '@/hooks/use-pick-image';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { DEFAULT_PROFILE_COLOR, UserStatus } from '@dodecagon/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Textarea
} from '@dodecagon/ui';
import { PaintBrushIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ColorPickerPopover } from './color-picker-popover';

// the bio is edited in place: the field stays transparent and keeps the height of
// the resting line, so nothing around it moves when the user starts typing
const BIO_FIELD_CLASS =
  'block min-h-[21px] w-full resize-none border-0 bg-transparent p-0 text-sm leading-[21px] text-foreground placeholder:text-muted-foreground focus-visible:ring-0';

type TProfileValues = {
  name: string;
  profileColor: string;
  bio: string;
  // undefined means untouched, null means remove
  avatar?: TPickedImage | null;
  banner?: TPickedImage | null;
};

const Profile = memo(() => {
  const { t } = useTranslation('settings');
  const ownPublicUser = useOwnPublicUser();
  const dateLocale = useDateLocale();
  const pickImage = usePickImage();
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [isBannerMenuOpen, setIsBannerMenuOpen] = useState(false);
  const [isNameDialogOpen, setIsNameDialogOpen] = useState(false);
  const nameButtonRef = useRef<HTMLButtonElement>(null);

  const onSave = useCallback(async (values: TProfileValues) => {
    const trpc = getTRPCClient();

    await trpc.users.update.mutate({
      name: values.name,
      profileColor: values.profileColor,
      bio: values.bio
    });

    if (values.avatar !== undefined) {
      await trpc.users.changeAvatar.mutate({ fileId: values.avatar?.fileId });
    }

    if (values.banner !== undefined) {
      await trpc.users.changeBanner.mutate({ fileId: values.banner?.fileId });
    }
  }, []);

  const { values, onChange } = useSettingsForm<TProfileValues>({
    initialValues: {
      name: ownPublicUser?.name ?? '',
      profileColor: ownPublicUser?.profileColor ?? DEFAULT_PROFILE_COLOR,
      bio: ownPublicUser?.bio ?? ''
    },
    onSave,
    successMessage: t('profileUpdated'),
    errorMessage: t('failedUpdateProfile')
  });

  const handleAvatarPick = useCallback(async () => {
    const picked = await pickImage();

    if (picked) onChange('avatar', picked);
  }, [onChange, pickImage]);

  const handleBannerPick = useCallback(async () => {
    const picked = await pickImage();

    if (picked) onChange('banner', picked);
  }, [onChange, pickImage]);
  const handleBannerMenuEscape = useCallback((event: Event) => {
    event.stopPropagation();
  }, []);

  const handleEditName = useCallback(() => {
    setIsNameDialogOpen(true);
  }, []);

  const handleCloseName = useCallback(() => {
    setIsNameDialogOpen(false);
  }, []);

  const handleConfirmName = useCallback(
    (nextName: string | undefined) => {
      setIsNameDialogOpen(false);
      if (!nextName) return;

      onChange('name', nextName);
    },
    [onChange]
  );

  const handleBioChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange('bio', event.target.value);
    },
    [onChange]
  );

  const handleOpenColorPicker = useCallback(() => {
    setIsColorPickerOpen(true);
  }, []);

  const handleRemoveBanner = useCallback(() => {
    onChange('banner', null);
  }, [onChange]);

  const handleColorChange = useCallback(
    (color: string) => onChange('profileColor', color),
    [onChange]
  );

  const userStatus = ownPublicUser?.status ?? UserStatus.OFFLINE;
  const statusLabel = useMemo(() => {
    if (userStatus === UserStatus.IDLE) return t('profileStatusIdle');
    if (userStatus === UserStatus.ONLINE) return t('profileStatusOnline');

    return t('profileStatusOffline');
  }, [userStatus, t]);

  if (!ownPublicUser) return null;

  const avatarUrl =
    values.avatar === undefined
      ? getFileUrl(ownPublicUser.avatar)
      : values.avatar?.previewUrl;
  const bannerUrl =
    values.banner === undefined
      ? getFileUrl(ownPublicUser.banner)
      : values.banner?.previewUrl;

  return (
    <SettingsSection title={t('profileTitle')}>
      <div
        role="group"
        aria-label={t('profileTitle')}
        className="w-full max-w-[320px] overflow-hidden rounded-[10px] border border-line bg-nav"
      >
        <DropdownMenu
          open={isBannerMenuOpen}
          onOpenChange={setIsBannerMenuOpen}
          modal={false}
        >
          <ColorPickerPopover
            open={isColorPickerOpen}
            onOpenChange={setIsColorPickerOpen}
            value={values.profileColor}
            onChange={handleColorChange}
            label={t('profileColorLabel')}
          >
            <span className="block">
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-profile-banner
                  aria-label={t('changeBannerLabel')}
                  className="group/banner relative block h-32 w-full overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ backgroundColor: values.profileColor }}
                >
                  {bannerUrl && (
                    <img
                      src={bannerUrl}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover/banner:bg-black/25 group-focus-visible/banner:bg-black/25',
                      isBannerMenuOpen && 'bg-black/25'
                    )}
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute top-2 right-2 z-10 flex size-9 items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover/banner:opacity-100 group-focus-visible/banner:opacity-100',
                      isBannerMenuOpen && 'opacity-100'
                    )}
                  >
                    <PaintBrushIcon className="size-5" />
                  </span>
                </button>
              </DropdownMenuTrigger>
            </span>
          </ColorPickerPopover>
          <DropdownMenuContent
            side="right"
            align="start"
            onEscapeKeyDown={handleBannerMenuEscape}
          >
            <DropdownMenuItem onClick={handleBannerPick}>
              {t('changeBannerLabel')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleOpenColorPicker}>
              {t('changeProfileColorLabel')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleRemoveBanner}
              disabled={!bannerUrl}
              variant="destructive"
            >
              {t('removeBannerLabel')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="px-4 pb-4">
          <div
            data-profile-avatar
            className="relative z-10 -mt-[60px] mb-1 size-[120px]"
          >
            <button
              type="button"
              onClick={handleAvatarPick}
              aria-label={t('changeAvatarLabel')}
              className="group/avatar relative flex size-full items-center justify-center overflow-hidden rounded-full border-4 border-nav bg-nav focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ backgroundColor: values.profileColor }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="size-full rounded-full object-cover"
                />
              ) : (
                <span className="text-4xl font-bold text-foreground">
                  {getInitialsFromName(values.name)}
                </span>
              )}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full bg-black/0 transition-colors group-hover/avatar:bg-black/55 group-focus-visible/avatar:bg-black/55"
              />
              <PaintBrushIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100"
              />
            </button>
            <UserStatusBadge
              status={userStatus}
              className="absolute right-0 bottom-0 size-5 border-4 border-nav"
            />
          </div>

          <button
            type="button"
            ref={nameButtonRef}
            onClick={handleEditName}
            className="block max-w-full truncate text-lg font-semibold leading-6 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {values.name}
            <span className="sr-only">{t('editNameLabel')}</span>
          </button>

          <div className="mt-0.5 text-xs leading-[18px] text-muted-foreground">
            {statusLabel}
          </div>

          <div className="mt-3">
            <Textarea
              aria-label={t('bioLabel')}
              value={values.bio}
              onChange={handleBioChange}
              placeholder={t('bioPlaceholder')}
              rows={1}
              className={BIO_FIELD_CLASS}
            />
          </div>

          <div className="mt-4 border-t border-line pt-3 text-xs text-muted-foreground">
            {t('memberSince', {
              date: format(new Date(ownPublicUser.createdAt), 'PP', {
                locale: dateLocale
              }),
              ns: 'common'
            })}
          </div>
        </div>
      </div>
      {isNameDialogOpen && (
        <TextInputDialog
          isOpen
          isModalOpen
          close={handleCloseName}
          onConfirm={handleConfirmName}
          finalFocus={nameButtonRef}
          title={t('usernameLabel')}
          confirmLabel={t('saveChanges')}
          allowEmpty={false}
        />
      )}
    </SettingsSection>
  );
});

export { Profile };
