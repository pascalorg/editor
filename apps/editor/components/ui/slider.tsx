import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const sliderVariants = cva(
  "relative flex w-full touch-none select-none overflow-hidden items-center",
  {
    variants: {
      variant: {
        default: "",
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
      variant: "default",
    },
  }
);

type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> &
  VariantProps<typeof sliderVariants>;

function Slider({ variant, className, ...props }: SliderProps) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(sliderVariants({ variant }), className)}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-muted relative h-3 w-full grow overflow-hidden rounded-full"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="bg-primary absolute h-full"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className={cn(
          "border-primary bg-background ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm",
          "transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        )}
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
