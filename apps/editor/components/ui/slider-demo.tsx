import { useState } from "react";
import NumberFlow from "@number-flow/react";

import { Slider } from "@/components/ui/slider";

export function SliderDemo() {
  const [value, setValue] = useState<number[]>([28.1]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#ededed] px-8">
      <section className="w-full max-w-lg">
        <div className="mb-2 flex items-end justify-between">
          <h2 className="text-xl font-semibold tracking-tight text-black">
            Temperature
          </h2>
          <NumberFlow
            value={value[0]}
            className="text-xl font-medium text-black/45"
            format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
            suffix="%"
          />
        </div>

        <Slider
          variant="temperature"
          value={value}
          onValueChange={setValue}
          min={0}
          max={100}
          step={0.1}
          aria-label="Temperature"
        />
      </section>
    </div>
  );
}

export default SliderDemo;
