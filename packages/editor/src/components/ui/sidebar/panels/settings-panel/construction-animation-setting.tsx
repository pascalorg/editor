'use client'

import type { ConstructionRevealLevel } from '@pascal-app/viewer'
import useConstructionReveal, {
  useConstructionRevealLevel,
  useFramingAvailable,
} from '../../../../../store/use-construction-reveal'
import { SegmentedControl } from '../../../controls/segmented-control'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../primitives/tooltip'

/** Why Framing is greyed out. */
export const FRAMING_NEEDS_BONES = 'Framing needs the Bones plugin.'

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

/**
 * The four levels as the control offers them: Framing is greyed out, with the reason as its tip,
 * where the project has no plugin that draws the framing.
 */
export function constructionLevelOptions(framingAvailable: boolean) {
  return OPTIONS.map((option) =>
    option.value === 'framing' && !framingAvailable
      ? { ...option, title: FRAMING_NEEDS_BONES, disabled: true }
      : { ...option, disabled: false },
  )
}

/** How much of an AI build plays as a construction. */
export function ConstructionAnimationSetting() {
  // What plays: the person's choice, or Framing where Bones is installed and Full where it is not.
  const level = useConstructionRevealLevel()
  const setLevel = useConstructionReveal((state) => state.setLevel)
  const framingAvailable = useFramingAvailable()
  const current = OPTIONS.find((option) => option.value === level)
  const options = constructionLevelOptions(framingAvailable).map((option) =>
    option.disabled
      ? {
          ...option,
          title: undefined,
          label: (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{option.label}</span>
              </TooltipTrigger>
              <TooltipContent>{option.title}</TooltipContent>
            </Tooltip>
          ),
        }
      : option,
  )
  return (
    <div className="space-y-2 py-1">
      <div className="space-y-0.5">
        <p className="font-medium text-sm">Construction animation</p>
        <p className="text-muted-foreground text-xs">{current?.title}</p>
      </div>
      <SegmentedControl
        aria-label="Construction animation"
        onChange={setLevel}
        options={options}
        value={level}
      />
    </div>
  )
}
