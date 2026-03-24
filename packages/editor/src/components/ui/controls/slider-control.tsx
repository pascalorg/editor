'use client'

import { MetricControl } from './metric-control'

interface SliderControlProps {
  label: React.ReactNode
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  precision?: number
  step?: number
  className?: string
  unit?: string
}

export function SliderControl(props: SliderControlProps) {
  return <MetricControl {...props} />
}
