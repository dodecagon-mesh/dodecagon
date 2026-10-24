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
      <Tooltip content={label}>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'rounded-[20px] bg-raised text-foreground transition-colors duration-150',
            enabled
              ? enabledClassName
              : (disabledClassName ?? 'hover:bg-panel'),
            disabled && 'opacity-60 hover:bg-raised'
          )}
          onClick={disabled ? undefined : onClick}
          disabled={disabled && !keepFocusableWhenDisabled}
          aria-disabled={disabled || undefined}
          aria-label={label}
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
