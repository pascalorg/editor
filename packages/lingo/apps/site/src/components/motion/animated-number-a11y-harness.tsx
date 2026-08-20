'use client'

import { AnimatedNumber } from '@/components/motion/animated-number'

export function AnimatedNumberA11yHarness() {
  return (
    <div aria-label="Animated number accessibility harness" role="group">
      <AnimatedNumber format={(value) => `${value.toFixed(2)} cm`} value={182.88} />
      <AnimatedNumber format={(value) => `${Math.round(value)}%`} value={91} />
    </div>
  )
}
