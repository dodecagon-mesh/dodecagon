import { cn } from '@/lib/utils';
import { ChevronDownIcon, UsersIcon } from '@heroicons/react/24/outline';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

type TParticipantsPillProps = {
  hidden: boolean;
  onToggle: () => void;
};

// the disclosure stays above the thumbnails, or above the toolbar when hidden
const ParticipantsPill = memo(
  ({ hidden, onToggle }: TParticipantsPillProps) => {
    const { t } = useTranslation('common');

    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label={hidden ? t('showParticipants') : t('hideParticipants')}
        aria-pressed={hidden}
        className={cn(
          'absolute left-1/2 bottom-full z-20 flex h-9 w-16 -translate-x-1/2 items-center justify-center gap-1.5',
          'rounded-full bg-black/80 text-white',
          'transition-colors hover:bg-black',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
        )}
      >
        <ChevronDownIcon
          className={cn('size-[14px]', hidden && 'rotate-180')}
        />
        <UsersIcon className="size-[18px]" />
      </button>
    );
  }
);

ParticipantsPill.displayName = 'ParticipantsPill';

export { ParticipantsPill };
