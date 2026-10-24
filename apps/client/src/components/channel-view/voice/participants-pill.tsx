import { cn } from '@/lib/utils';
import { ChevronDownIcon, UsersIcon } from '@heroicons/react/24/outline';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

type TParticipantsPillProps = {
  hidden: boolean;
  onToggle: () => void;
};

// The pill hangs over the top edge of the participant strip, the way the
// Discord control does. It never covers the demo above the strip.
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
          'absolute left-1/2 z-20 flex h-9 w-16 -translate-x-1/2 items-center justify-center gap-1.5',
          'rounded-[18px] border border-line bg-nav/85 text-foreground backdrop-blur',
          'transition-colors hover:bg-nav',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
          // over the strip the pill hangs above its top edge, hidden it takes
          // the place where the strip would be
          hidden ? 'top-0' : '-top-4'
        )}
      >
        <ChevronDownIcon className="size-[14px]" />
        <UsersIcon className="size-[18px]" />
      </button>
    );
  }
);

ParticipantsPill.displayName = 'ParticipantsPill';

export { ParticipantsPill };
