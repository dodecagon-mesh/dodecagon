import { Protect } from '@/components/protect';
import { useDateLocale } from '@/hooks/use-date-locale';
import { Permission } from '@dodecagon/shared';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  IconButton,
  Tooltip
} from '@dodecagon/ui';
import {
  CalendarIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  EyeIcon,
  EyeSlashIcon,
  GlobeAltIcon,
  IdentificationIcon,
  KeyIcon,
  ScaleIcon,
  ShareIcon
} from '@heroicons/react/24/outline';
import { format, formatDistanceToNow } from 'date-fns';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModViewContext } from '../context';

type TRowProps = {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  details?: string;
  hidden?: boolean;
};

const Row = memo(
  ({ icon, label, value, details, hidden = false }: TRowProps) => {
    const [visible, setVisible] = useState(!hidden);

    let valContent = (
      <span className="text-sm text-muted-foreground truncate max-w-[160px]">
        {visible ? value : '***'}
      </span>
    );

    if (details) {
      valContent = <Tooltip content={details}>{valContent}</Tooltip>;
    }

    return (
      <div className="flex items-center justify-between py-1.5 px-1 gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {icon}
          <span className="text-sm truncate">{label}</span>
        </div>
        {valContent}
        {hidden && (
          <IconButton
            role="button"
            onClick={() => setVisible(!visible)}
            className="text-muted-foreground inline-flex h-6 w-6 items-center justify-center rounded bg-transparent hover:bg-accent hover:text-foreground cursor-pointer transition-colors focus:outline-none"
            icon={visible ? EyeSlashIcon : EyeIcon}
          />
        )}
      </div>
    );
  }
);

const Details = memo(() => {
  const { t } = useTranslation('settings');
  const dateLocale = useDateLocale();
  const { user, logins } = useModViewContext();
  const lastLogin = logins[0]; // TODO: in the future we might show a list of logins, atm we just show info about the last one

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardDocumentListIcon className="h-5 w-5" />
          {t('detailsTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="space-y-2">
          <Row
            icon={
              <IdentificationIcon className="h-4 w-4 text-muted-foreground" />
            }
            label={t('userIdLabel')}
            value={user.id}
          />

          <Protect permission={Permission.VIEW_USER_SENSITIVE_DATA}>
            <Row
              icon={
                <IdentificationIcon className="h-4 w-4 text-muted-foreground" />
              }
              label={t('identityDetailLabel')}
              value={user.identity ?? ''}
              hidden
            />

            <Row
              icon={<ShareIcon className="h-4 w-4 text-muted-foreground" />}
              label={t('ipAddressLabel')}
              value={lastLogin?.ip || t('unknownValue')}
              hidden
            />

            <Row
              icon={<GlobeAltIcon className="h-4 w-4 text-muted-foreground" />}
              label={t('locationLabel')}
              value={`${lastLogin?.country || t('naValue')} - ${lastLogin?.city || t('naValue')}`}
              hidden
            />
          </Protect>

          <Row
            icon={<KeyIcon className="h-4 w-4 text-muted-foreground" />}
            label={t('accountSourceLabel')}
            value={
              user.isOidcUser
                ? t('accountSourceOidc')
                : t('accountSourcePassword')
            }
          />

          <Row
            icon={<CalendarIcon className="h-4 w-4 text-muted-foreground" />}
            label={t('joinedServerLabel')}
            value={formatDistanceToNow(user.createdAt, {
              addSuffix: true,
              locale: dateLocale
            })}
          />

          <Row
            icon={<ClockIcon className="h-4 w-4 text-muted-foreground" />}
            label={t('lastActiveLabel')}
            value={formatDistanceToNow(user.lastLoginAt, {
              addSuffix: true,
              locale: dateLocale
            })}
          />

          {user.banned && (
            <>
              <Row
                icon={<ScaleIcon className="h-4 w-4 text-muted-foreground" />}
                label={t('bannedDetailLabel')}
                value={t('bannedDetailValue')}
              />

              <Row
                icon={<ScaleIcon className="h-4 w-4 text-muted-foreground" />}
                label={t('banReasonLabel')}
                value={user.banReason || t('noReasonProvidedDetail')}
              />

              <Row
                icon={<ScaleIcon className="h-4 w-4 text-muted-foreground" />}
                label={t('bannedAtLabel')}
                value={format(user.bannedAt ?? 0, 'PPP', {
                  locale: dateLocale
                })}
                details={format(user.bannedAt ?? 0, 'PPpp', {
                  locale: dateLocale
                })}
              />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

export { Details };
