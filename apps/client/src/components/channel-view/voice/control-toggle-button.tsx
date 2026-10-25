import { cn } from '@/lib/utils';
import { Button, Tooltip } from '@dodecagon/ui';
import { memo } from 'react';

type TIconComponent = React.ComponentType<{
  size?: number;
  className?: string;
}>;

type TControlToggleButtonProps = {
  enabled: boolean;
  enabledLabel: string;
  disabledLabel: string;
  description?: string;
  enabledIcon: TIconComponent;
  disabledIcon: TIconComponent;

  enabledClassName: string;
  disabledClassName?: string;

  onClick: () => void;
  disabled?: boolean;
  keepFocusableWhenDisabled?: boolean;
};

const ControlToggleButton = memo(
  ({
    enabled,
    enabledLabel,
    disabledLabel,
    description,
    enabledIcon: EnabledIcon,
    disabledIcon: DisabledIcon,
    enabledClassName,
    disabledClassName,
    onClick,
    disabled,
    keepFocusableWhenDisabled = false
  }: TControlToggleButtonProps) => {
    const label = enabled ? enabledLabel : disabledLabel;

    return (
      <Tooltip content={description ?? label}>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'size-10 rounded-[7px] bg-transparent text-white transition-colors duration-150 max-[360px]:size-9',
            enabled
              ? enabledClassName
              : (disabledClassName ?? 'hover:bg-white/10 hover:text-white'),
            disabled && 'opacity-60 hover:bg-transparent'
          )}
          onClick={disabled ? undefined : onClick}
          disabled={disabled && !keepFocusableWhenDisabled}
          aria-disabled={disabled || undefined}
          aria-label={label}
          aria-description={description}
        >
          {enabled ? (
            <EnabledIcon className="size-5" />
          ) : (
            <DisabledIcon className="size-5" />
          )}
        </Button>
      </Tooltip>
    );
  }
);

ControlToggleButton.displayName = 'ControlToggleButton';

export { ControlToggleButton };
export type { TControlToggleButtonProps };
