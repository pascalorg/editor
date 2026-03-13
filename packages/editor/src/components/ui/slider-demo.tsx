import NumberFlow from '@number-flow/react'
import { useState } from 'react'

import { Slider } from './../../components/ui/slider'

export function SliderDemo() {
  const [value, setValue] = useState<number[]>([28.1])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#ededed] px-8">
      <section className="w-full max-w-lg">
        <div className="mb-2 flex items-end justify-between">
          <h2 className="font-semibold text-black text-xl tracking-tight">Temperature</h2>
          <NumberFlow
            className="font-medium text-black/45 text-xl"
            format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
            suffix="%"
            value={value[0] ?? 50}
          />
        </div>

        <Slider
          aria-label="Temperature"
          max={100}
          min={0}
          onValueChange={setValue}
          step={0.1}
          value={value}
          variant="temperature"
        />
      </section>
    </div>
  )
}

export default SliderDemo
