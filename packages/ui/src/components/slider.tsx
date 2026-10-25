import {
  Slider as SliderPrimitive,
  type SliderRootProps
} from '@base-ui/react/slider';
import * as React from 'react';

import { cn } from '../lib/utils';

interface SliderProps extends Omit<SliderRootProps<number[]>, 'ref'> {
  rightSlot?: React.ReactNode;
  ref?: React.Ref<HTMLSpanElement>;
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  rightSlot,
  ref,
  ...props
}: SliderProps) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  );

  const sliderElement = (
    <SliderPrimitive.Root
      ref={ref as React.Ref<HTMLDivElement>}
      render={<span />}
      data-slot="slider"
      defaultValue={Array.isArray(value) ? undefined : _values}
      value={value}
      min={min}
      max={max}
      className={cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        rightSlot ? 'flex-1' : '',
        className
      )}
      {...props}
    >
      <SliderPrimitive.Control
        data-slot="slider-control"
        className="relative flex items-center data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:flex-col"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            'bg-control-border relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5'
          )}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn(
              'bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full'
            )}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            key={index}
            index={index}
            data-slot="slider-thumb"
            aria-label={props['aria-label']}
            aria-labelledby={props['aria-labelledby']}
            className="border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-within:ring-4 focus-visible:outline-hidden data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );

  if (rightSlot) {
    return (
      <div className="flex items-center gap-3 w-full">
        {sliderElement}
        <div className="shrink-0">{rightSlot}</div>
      </div>
    );
  }

  return sliderElement;
}

export { Slider };
