'use client'

import type { ConstructionRevealLevel } from '@pascal-app/viewer'
import useConstructionReveal from '../../../../../store/use-construction-reveal'
import { SegmentedControl } from '../../../controls/segmented-control'

const OPTIONS: { label: string; value: ConstructionRevealLevel; title: string }[] = [
  { label: 'Off', value: 'off', title: 'What the AI builds appears at once.' },
  {
    label: 'Simple',
    value: 'simple',
    title: 'Walls rise and the rest grows in, piece by piece. No falls, no dust, no sound.',
  },
  {
    label: 'Full',
    value: 'full',
    title: 'Pieces drop into place with dust, the roof assembles, one sound per phase.',
  },
  {
    label: 'Framing',
    value: 'framing',
    title: 'Full, plus the framing members dropping in first, where the framing plugin draws them.',
  },
]

/** How much of an AI build plays as a construction. */
export function ConstructionAnimationSetting() {
  const level = useConstructionReveal((state) => state.level)
  const setLevel = useConstructionReveal((state) => state.setLevel)
  const current = OPTIONS.find((option) => option.value === level)
  return (
    <div className="space-y-2 py-1">
      <div className="space-y-0.5">
        <p className="font-medium text-sm">Construction animation</p>
        <p className="text-muted-foreground text-xs">{current?.title}</p>
      </div>
      <SegmentedControl
        aria-label="Construction animation"
        onChange={setLevel}
        options={OPTIONS}
        value={level}
      />
    </div>
  )
}
