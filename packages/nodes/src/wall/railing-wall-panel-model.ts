import {
  getEffectiveNode,
  getRailingWallConfig,
  getRailingWallHeight,
  RAILING_GUARD_HEIGHT,
  RAILING_GUARD_HEIGHT_TALL,
  RAILING_STYLE_DEFAULTS,
  type RailingWallConfig,
  type RailingWallStyle,
  railingWallDefaults,
  type WallNode,
} from '@pascal-app/core'
import type { PanelRow } from '@pascal-app/editor'

const INCH = 0.0254

export const RAILING_STYLE_OPTIONS: { label: string; value: RailingWallStyle }[] = [
  { label: 'Post & rail', value: 'post-and-rail' },
  { label: 'Balusters', value: 'balusters' },
  { label: 'Cable', value: 'cable' },
  { label: 'Boards', value: 'boards' },
  { label: 'Glass', value: 'glass' },
  { label: 'Metal', value: 'metal' },
]

/** What a style's infill is called, and its gap where it has one. */
export const RAILING_INFILL_LABELS: Record<RailingWallStyle, { size: string; gap: string | null }> =
  {
    'post-and-rail': { size: 'Baluster size', gap: 'Baluster gap' },
    balusters: { size: 'Baluster size', gap: 'Baluster gap' },
    metal: { size: 'Bar size', gap: 'Bar gap' },
    cable: { size: 'Cable size', gap: 'Cable gap' },
    boards: { size: 'Board width', gap: 'Board gap' },
    glass: { size: 'Glass thickness', gap: null },
  }

/** The styles a 2x6 cap is laid over. */
export const RAILING_CAPPED_STYLES: ReadonlySet<RailingWallStyle> = new Set([
  'post-and-rail',
  'boards',
])

/** The guard heights offered at a click: 36 in (IRC R312.1.2) and 42 in (IBC 1015.3). */
export function railingHeightPreset(height: number): '36' | '42' | null {
  if (Math.abs(height - RAILING_GUARD_HEIGHT) < 1e-4) return '36'
  if (Math.abs(height - RAILING_GUARD_HEIGHT_TALL) < 1e-4) return '42'
  return null
}

/**
 * A wall turned into a railing: the railing it had, else the default one, as thick as its posts
 * and 36 in tall unless it already stands no taller than a 42 in guard, with no assembly.
 */
export function railingWallTypePatch(wall: WallNode): Partial<WallNode> {
  const defaults = railingWallDefaults()
  const railing = wall.railing ? getRailingWallConfig(wall) : defaults.railing
  return {
    ...defaults,
    railing,
    thickness: railing.postSize,
    height:
      wall.height !== undefined && wall.height <= RAILING_GUARD_HEIGHT_TALL + 1e-6
        ? wall.height
        : RAILING_GUARD_HEIGHT,
  }
}

/** A railing edit: its config with `patch` over it, and its thickness its posts'. */
export function getRailingWallUpdate(
  node: WallNode,
  patch: Partial<RailingWallConfig>,
): Pick<WallNode, 'railing' | 'thickness'> {
  const railing = { ...getRailingWallConfig(getEffectiveNode(node)), ...patch }
  return { railing, thickness: railing.postSize }
}

/** A style's members, picked with it (`RAILING_STYLE_DEFAULTS`). */
export function railingStylePatch(style: RailingWallStyle): Partial<RailingWallConfig> {
  return { ...RAILING_STYLE_DEFAULTS[style], style }
}

/**
 * A railing's rows in the compact wall panel (`wallSettings`), the Railing section's controls:
 * style, guard height, cap, posts and infill. Lengths in metres.
 */
export function railingWallRows(
  node: WallNode,
  update: (patch: Partial<WallNode>) => void,
): PanelRow[] {
  const config = getRailingWallConfig(node)
  const height = getRailingWallHeight(node)
  const set = (patch: Partial<RailingWallConfig>) => update(getRailingWallUpdate(node, patch))
  const styles = RAILING_STYLE_OPTIONS
  const at = Math.max(
    0,
    styles.findIndex((option) => option.value === config.style),
  )
  const cycleStyle = (by: number) =>
    set(railingStylePatch(styles[(at + by + styles.length) % styles.length]!.value))
  const stepper = (
    section: string,
    id: string,
    label: string,
    value: number,
    min: number,
    step: number,
    onChange: (value: number) => void,
  ): PanelRow => ({
    section,
    id,
    kind: 'stepper',
    label,
    value,
    min,
    max: 1000,
    step,
    unit: 'm',
    onChange: (next) => onChange(Math.min(Math.max(next, min), 1000)),
  })
  const preset = railingHeightPreset(height)
  const infill = RAILING_INFILL_LABELS[config.style]
  const rows: PanelRow[] = [
    {
      section: 'Railing',
      id: 'railing-style',
      kind: 'cycle',
      label: 'Style',
      value: styles[at]!.label,
      next: () => cycleStyle(1),
      previous: () => cycleStyle(-1),
    },
    {
      section: 'Railing',
      id: 'railing-guard',
      kind: 'choice',
      label: 'Guard',
      value: preset === '42' ? '42 in' : preset === '36' ? '36 in' : 'Custom',
      onSelect: () =>
        update({ height: preset === '36' ? RAILING_GUARD_HEIGHT_TALL : RAILING_GUARD_HEIGHT }),
    },
    stepper('Railing', 'height', 'Height', height, 0.1, INCH, (next) => update({ height: next })),
  ]
  if (RAILING_CAPPED_STYLES.has(config.style))
    rows.push({
      section: 'Railing',
      id: 'railing-cap',
      kind: 'choice',
      label: '2x6 cap',
      value: config.cap ? 'On' : 'Off',
      onSelect: () => set({ cap: !config.cap }),
    })
  rows.push(
    stepper('Posts', 'railing-post-spacing', 'Max spacing', config.postSpacing, 0.1, INCH, (v) =>
      set({ postSpacing: v }),
    ),
    stepper('Posts', 'railing-post-size', 'Post size', config.postSize, 0.01, INCH / 2, (v) =>
      set({ postSize: v }),
    ),
    stepper('Infill', 'railing-infill-size', infill.size, config.infillSize, 0.003, INCH / 8, (v) =>
      set({ infillSize: v }),
    ),
  )
  if (infill.gap)
    rows.push(
      stepper('Infill', 'railing-infill-gap', infill.gap, config.infillGap, 0, INCH / 8, (v) =>
        set({ infillGap: v }),
      ),
    )
  rows.push(
    stepper(
      'Infill',
      'railing-clearance',
      'Floor clearance',
      config.bottomClearance,
      0,
      INCH / 8,
      (v) => set({ bottomClearance: v }),
    ),
  )
  return rows
}
