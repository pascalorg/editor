import * as SliderPrimitive from '@radix-ui/react-slider'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from './../../lib/utils'

const sliderVariants = cva(
  'relative flex w-full touch-none select-none items-center overflow-hidden',
  {
    variants: {
      variant: {
        default: '',
        temperature: `
          h-16
          [&_[data-slot=slider-track]]:h-14
          [&_[data-slot=slider-track]]:rounded-xl
          [&_[data-slot=slider-track]]:border
          [&_[data-slot=slider-track]]:border-neutral-300
          [&_[data-slot=slider-track]]:bg-white/50
          [&_[data-slot=slider-track]]:shadow-[0_1px_2px_0px_rgba(0,0,0,0.1)]
          [&_[data-slot=slider-track]]:ring-1
          [&_[data-slot=slider-track]]:ring-white
          [&_[data-slot=slider-track]]:ring-inset
          [&_[data-slot=slider-range]]:inset-y-0.5
          [&_[data-slot=slider-range]]:h-auto
          [&_[data-slot=slider-range]]:ml-0.5
          [&_[data-slot=slider-range]]:mr-0.5
          [&_[data-slot=slider-range]]:overflow-hidden
          [&_[data-slot=slider-range]]:rounded-lg
          [&_[data-slot=slider-range]]:border
          [&_[data-slot=slider-range]]:border-neutral-300
          [&_[data-slot=slider-range]]:bg-white
          [&_[data-slot=slider-range]]:shadow-xs
          [&_[data-slot=slider-thumb]]:h-7
          [&_[data-slot=slider-thumb]]:w-[3px]
          [&_[data-slot=slider-thumb]]:rounded-xl
          [&_[data-slot=slider-thumb]]:border-0
          [&_[data-slot=slider-thumb]]:bg-neutral-100
          [&_[data-slot=slider-thumb]]:shadow-none
          [&_[data-slot=slider-thumb]]:cursor-ew-resize
          [&_[data-slot=slider-thumb]]:[transform:translateX(-8px)]
          [&_[data-slot=slider-thumb]]:ring-0
          [&_[data-slot=slider-thumb]]:hover:ring-0
          [&_[data-slot=slider-thumb]]:focus-visible:ring-0
        `,
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> &
  VariantProps<typeof sliderVariants>

function Slider({ variant, className, ...props }: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn(sliderVariants({ variant }), className)}
      data-slot="slider"
      {...props}
    >
      <SliderPrimitive.Track
        className="relative h-3 w-full grow overflow-hidden rounded-full bg-muted"
        data-slot="slider-track"
      >
        <SliderPrimitive.Range className="absolute h-full bg-primary" data-slot="slider-range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          'block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm ring-ring/50',
          'transition-[color,box-shadow] hover:ring-4 focus-visible:outline-none focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50',
        )}
        data-slot="slider-thumb"
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
