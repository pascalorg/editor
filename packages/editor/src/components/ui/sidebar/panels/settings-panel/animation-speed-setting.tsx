'use client'

import { ANIMATION_SPEEDS, type AnimationSpeed, normalizeAnimationSpeed } from '@pascal-app/viewer'
import useConstructionReveal from '../../../../../store/use-construction-reveal'
import { SegmentedControl } from '../../../controls/segmented-control'

const label = (speed: AnimationSpeed) => `×${speed}`

// The control's values are strings; a step is its number as text.
const OPTIONS = ANIMATION_SPEEDS.map((speed) => ({
  label: label(speed),
  value: String(speed),
  title: speed === 1 ? 'The pace builds were made at.' : `Builds play ×${speed} as fast.`,
}))

/** How fast what the AI builds plays: ×0.5 to ×2, for the Full and Framing animations and their undo. */
export function AnimationSpeedSetting() {
  const level = useConstructionReveal((state) => state.level)
  const speed = useConstructionReveal((state) => state.speed)
  const setSpeed = useConstructionReveal((state) => state.setSpeed)
  const off = level === 'off'
  return (
    <div className="space-y-2 py-1">
      <div className="space-y-0.5">
        <p className="font-medium text-sm">Animation speed</p>
        <p className="text-muted-foreground text-xs">
          {off
            ? 'Turn the construction animation on to use this.'
            : 'Higher plays a build faster; it applies to the next build.'}
        </p>
      </div>
      <SegmentedControl
        aria-label="Animation speed"
        onChange={(value) => setSpeed(normalizeAnimationSpeed(Number(value)))}
        options={OPTIONS}
        value={String(speed)}
      />
    </div>
  )
}
