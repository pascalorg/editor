import type { ToolOption } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'

type RunKind = 'duct-segment' | 'pipe-segment'

export function updateRunDefaults(kind: RunKind, patch: Record<string, unknown>): void {
  const editor = useEditor.getState()
  editor.setToolDefaults(kind, { ...editor.toolDefaults[kind], ...patch })
}

export function clearRunContinuation(kind: RunKind): void {
  const { continuation: _continuation, ...settings } = useEditor.getState().toolDefaults[kind] ?? {}
  useEditor.getState().setToolDefaults(kind, settings)
}

function choice(
  kind: RunKind,
  key: string,
  label: string,
  values: readonly [string, string, string?][],
  fallback: string,
): ToolOption {
  return {
    id: key,
    label,
    choices: values.map(([value, label, description]) => ({ value, label, description })),
    subscribe: useEditor.subscribe,
    value: () => String(useEditor.getState().toolDefaults[kind]?.[key] ?? fallback),
    set: (value) => updateRunDefaults(kind, { [key]: value }),
  }
}

function number(
  kind: RunKind,
  key: string,
  label: string,
  fallback: number,
  input: NonNullable<ToolOption['input']>,
): ToolOption {
  return {
    ...choice(kind, key, label, [], String(fallback)),
    input,
    set: (value) => {
      const next = Number(value)
      if (
        !Number.isFinite(next) ||
        (input.min !== undefined && next < input.min) ||
        (input.max !== undefined && next > input.max)
      )
        return
      updateRunDefaults(kind, { [key]: next })
    },
  }
}

function routing(kind: RunKind): ToolOption[] {
  return [
    choice(
      kind,
      'routingMode',
      'Route',
      [
        ['surface', 'Follow surface', 'Follow the floor, wall, or ceiling under the pointer.'],
        [
          'horizontal',
          kind === 'pipe-segment' ? 'Plan route' : 'Horizontal',
          kind === 'pipe-segment'
            ? 'Follow a plan direction, applying the chosen fall from the start elevation.'
            : 'Keep the run at its starting elevation.',
        ],
        ['vertical', 'Vertical', 'Keep X and Z fixed. Enter the target elevation below.'],
      ],
      'surface',
    ),
    {
      ...number(kind, 'elevation', 'Start elevation above level', 0, { unit: 'm', step: 0.01 }),
      visible: {
        subscribe: useEditor.subscribe,
        value: () =>
          ['horizontal', 'vertical'].includes(
            String(useEditor.getState().toolDefaults[kind]?.routingMode),
          ),
      },
    },
    {
      ...number(kind, 'targetElevation', 'Target elevation above level', 3, {
        unit: 'm',
        step: 0.01,
      }),
      visible: {
        subscribe: useEditor.subscribe,
        value: () => useEditor.getState().toolDefaults[kind]?.routingMode === 'vertical',
      },
    },
    choice(
      kind,
      'crossingMode',
      'Crossing another run',
      [
        ['connect', 'Connect', 'Insert a fitting where runs meet.'],
        [
          'cross',
          'Cross without joining',
          'Keep the runs separate. This does not provide physical clearance.',
        ],
      ],
      'connect',
    ),
  ]
}

const ductProfile = (round: boolean) => ({
  subscribe: useEditor.subscribe,
  value: () => (useEditor.getState().toolDefaults['duct-segment']?.shape === 'round') === round,
})

const ductPresets = {
  trunk: { shape: 'rect', width: 14, height: 8, ductMaterial: 'sheet-metal', system: 'supply' },
  branch: { shape: 'round', diameter: 6, ductMaterial: 'spiral', system: 'supply' },
  flex: { shape: 'round', diameter: 6, ductMaterial: 'flex', system: 'supply' },
  return: { shape: 'rect', width: 20, height: 10, ductMaterial: 'sheet-metal', system: 'return' },
} as const

export const ductRunToolOptions: ToolOption[] = [
  {
    ...choice(
      'duct-segment',
      'preset',
      'Starting profile',
      [
        ['custom', 'Custom'],
        ['trunk', 'Supply trunk · 14 × 8 in'],
        ['branch', 'Round branch · 6 in'],
        ['flex', 'Flex connection · 6 in'],
        ['return', 'Return trunk · 20 × 10 in'],
      ],
      'custom',
    ),
    value: () => {
      const current = useEditor.getState().toolDefaults['duct-segment'] ?? {}
      return (
        Object.entries(ductPresets).find(([, preset]) =>
          Object.entries(preset).every(([key, value]) => current[key] === value),
        )?.[0] ?? 'custom'
      )
    },
    set: (value) => {
      const preset = ductPresets[value as keyof typeof ductPresets]
      if (preset) updateRunDefaults('duct-segment', preset)
    },
  },
  choice(
    'duct-segment',
    'system',
    'System',
    [
      ['supply', 'Supply'],
      ['return', 'Return'],
    ],
    'supply',
  ),
  choice(
    'duct-segment',
    'shape',
    'Profile',
    [
      ['round', 'Round'],
      ['rect', 'Rectangular'],
      ['oval', 'Oval'],
    ],
    'rect',
  ),
  {
    ...number('duct-segment', 'diameter', 'Diameter', 6, { min: 2, max: 48, unit: 'in' }),
    visible: ductProfile(true),
  },
  {
    ...number('duct-segment', 'width', 'Width', 14, { min: 4, max: 60, unit: 'in' }),
    visible: ductProfile(false),
  },
  {
    ...number('duct-segment', 'height', 'Height', 8, { min: 3, max: 40, unit: 'in' }),
    visible: ductProfile(false),
  },
  choice(
    'duct-segment',
    'ductMaterial',
    'Material',
    [
      ['flex', 'Flex'],
      ['sheet-metal', 'Sheet metal'],
      ['spiral', 'Spiral'],
      ['duct-board', 'Ductboard'],
    ],
    'flex',
  ),
  ...routing('duct-segment'),
]

export const pipeRunToolOptions: ToolOption[] = [
  choice(
    'pipe-segment',
    'system',
    'System',
    [
      ['waste', 'Waste'],
      ['vent', 'Vent'],
    ],
    'waste',
  ),
  number('pipe-segment', 'diameter', 'Diameter', 2, { min: 1.25, max: 8, unit: 'in' }),
  choice(
    'pipe-segment',
    'pipeMaterial',
    'Material',
    [
      ['pvc', 'PVC'],
      ['abs', 'ABS'],
      ['cast-iron', 'Cast iron'],
    ],
    'pvc',
  ),
  {
    ...choice(
      'pipe-segment',
      'fall',
      'Fall',
      [
        ['level', 'Level'],
        ['sloped', 'Graded', 'Apply the grade and flow direction below.'],
      ],
      'level',
    ),
    visible: {
      subscribe: useEditor.subscribe,
      value: () =>
        (useEditor.getState().toolDefaults['pipe-segment']?.system ?? 'waste') === 'waste',
    },
  },
  {
    ...number('pipe-segment', 'gradePercent', 'Grade', 100 / 48, { min: 0, step: 0.1, unit: '%' }),
    visible: {
      subscribe: useEditor.subscribe,
      value: () =>
        useEditor.getState().toolDefaults['pipe-segment']?.fall === 'sloped' &&
        (useEditor.getState().toolDefaults['pipe-segment']?.system ?? 'waste') === 'waste',
    },
  },
  choice(
    'pipe-segment',
    'flowDirection',
    'Downhill flow',
    [
      ['forward', 'Start → end'],
      ['reverse', 'End → start'],
    ],
    'forward',
  ),
  ...routing('pipe-segment'),
]
