import type { ToolOption } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { reducerOutletDiameter } from './reducer-size'

const label = (value: string) =>
  (
    ({
      rect: 'Rectangular',
      pvc: 'PVC',
      abs: 'ABS',
      'access-panel': 'Access panel',
      damper: 'Balancing damper',
    }) as Record<string, string>
  )[value] ?? value.replaceAll('-', ' ').replace(/^./, (c) => c.toUpperCase())
function option(
  kind: 'duct-fitting' | 'pipe-fitting',
  key: string,
  title: string,
  choices: readonly string[],
  fallback: string,
  numeric = false,
  types?: string[],
): ToolOption {
  return {
    id: key,
    label: title,
    choices: choices.map((value) => ({
      value,
      label: label(value),
      ...(key === 'fittingType' && value === 'reducer'
        ? { description: 'Connects matching profiles with different sizes.' }
        : key === 'fittingType' && value === 'transition'
          ? {
              description:
                'Connects round, rectangular, or oval profiles. Choose the shape and size of each end.',
            }
          : {}),
    })),
    value: () => String(useEditor.getState().toolDefaults[kind]?.[key] ?? fallback),
    subscribe: (callback) => useEditor.subscribe(callback),
    set: (value) => {
      const defaults = {
        ...useEditor.getState().toolDefaults[kind],
        [key]: numeric ? Number(value) : value,
      }
      if (
        kind === 'duct-fitting' &&
        key === 'fittingType' &&
        ['reducer', 'transition'].includes(value)
      ) {
        defaults.inletShape = value === 'reducer' ? 'round' : 'rect'
        defaults.outletShape = 'round'
      }
      if (kind === 'duct-fitting' && defaults.fittingType === 'transition') {
        const inlet = defaults.inletShape ?? 'rect'
        const outlet = defaults.outletShape ?? 'round'
        if (inlet === outlet) {
          if (key === 'outletShape') defaults.inletShape = outlet === 'round' ? 'rect' : 'round'
          else defaults.outletShape = inlet === 'round' ? 'rect' : 'round'
        }
      }
      if (defaults.fittingType === 'reducer') {
        const inlet = Number(defaults.diameter ?? (kind === 'duct-fitting' ? 12 : 2))
        const outlet = Number(defaults.diameter2 ?? inlet)
        defaults.diameter2 = reducerOutletDiameter(kind, inlet, outlet)
      }
      if (kind === 'duct-fitting' && key === 'shape') defaults.shape2 = value
      useEditor.getState().setToolDefaults(kind, defaults)
    },
    ...(types
      ? {
          visible: {
            subscribe: (callback: () => void) => useEditor.subscribe(callback),
            value: () =>
              types.includes(
                String(useEditor.getState().toolDefaults[kind]?.fittingType ?? 'elbow'),
              ),
          },
        }
      : {}),
  }
}

export const ductFittingToolOptions: ToolOption[] = [
  option(
    'duct-fitting',
    'fittingType',
    'Duct fittings & accessories',
    ['elbow', 'tee', 'cross', 'reducer', 'transition', 'end-cap', 'damper', 'access-panel'],
    'elbow',
  ),
  option('duct-fitting', 'shape', 'Profile', ['round', 'rect', 'oval'], 'rect', false, [
    'elbow',
    'tee',
    'cross',
    'end-cap',
    'damper',
  ]),
  option('duct-fitting', 'inletShape', 'Inlet profile', ['round', 'rect', 'oval'], 'rect', false, [
    'transition',
    'reducer',
  ]),
  option(
    'duct-fitting',
    'outletShape',
    'Outlet profile',
    ['round', 'rect', 'oval'],
    'round',
    false,
    ['transition', 'reducer'],
  ),
  {
    ...option(
      'duct-fitting',
      'width2',
      'Outlet width (in)',
      ['8', '10', '14', '20', '24'],
      '14',
      true,
      ['transition', 'reducer'],
    ),
    id: 'outletWidth',
  },
  {
    ...option(
      'duct-fitting',
      'height2',
      'Outlet height (in)',
      ['4', '6', '8', '12', '16'],
      '8',
      true,
      ['transition', 'reducer'],
    ),
    id: 'outletHeight',
  },
  option('duct-fitting', 'diameter', 'Diameter (in)', ['4', '6', '8', '10', '12'], '12', true),
  option('duct-fitting', 'width', 'Width (in)', ['8', '10', '14', '20', '24'], '14', true),
  option('duct-fitting', 'height', 'Height (in)', ['4', '6', '8', '12', '16'], '8', true),
  option(
    'duct-fitting',
    'diameter2',
    'Outlet diameter (in)',
    ['2', '4', '6', '8', '10', '12'],
    '12',
    true,
    ['reducer', 'transition'],
  ),
  {
    ...option(
      'duct-fitting',
      'diameter2',
      'Branch diameter (in)',
      ['2', '4', '6', '8', '10', '12'],
      '12',
      true,
      ['tee', 'cross'],
    ),
    id: 'branchDiameter',
  },
  option('duct-fitting', 'shape2', 'Branch profile', ['round', 'rect', 'oval'], 'rect', false, [
    'tee',
    'cross',
  ]),
  option('duct-fitting', 'width2', 'Branch width (in)', ['8', '10', '14', '20', '24'], '14', true, [
    'tee',
    'cross',
  ]),
  option('duct-fitting', 'height2', 'Branch height (in)', ['4', '6', '8', '12', '16'], '8', true, [
    'tee',
    'cross',
  ]),
  option('duct-fitting', 'damperAngle', 'Blade opening (°)', ['0', '45', '90'], '0', true, [
    'damper',
  ]),
  option(
    'duct-fitting',
    'panelWidth',
    'Access door width (m)',
    ['0.15', '0.25', '0.4'],
    '0.25',
    true,
    ['access-panel'],
  ),
  option(
    'duct-fitting',
    'panelHeight',
    'Access door height (m)',
    ['0.1', '0.15', '0.25'],
    '0.15',
    true,
    ['access-panel'],
  ),
]
export const pipeFittingToolOptions: ToolOption[] = [
  option(
    'pipe-fitting',
    'fittingType',
    'Pipe fittings & accessories',
    ['elbow', 'wye', 'sanitary-tee', 'cross', 'end-cap', 'cleanout', 'reducer', 'coupling'],
    'elbow',
  ),
  option(
    'pipe-fitting',
    'diameter',
    'Diameter (in)',
    ['1.25', '1.5', '2', '3', '4', '6', '8'],
    '2',
    true,
  ),
  option(
    'pipe-fitting',
    'diameter2',
    'Outlet diameter (in)',
    ['1.25', '1.5', '2', '3', '4', '6', '8'],
    '2',
    true,
    ['reducer'],
  ),
  {
    ...option(
      'pipe-fitting',
      'diameter2',
      'Branch diameter (in)',
      ['1.25', '1.5', '2', '3', '4', '6', '8'],
      '2',
      true,
      ['wye', 'sanitary-tee', 'cross'],
    ),
    id: 'branchDiameter',
  },
  option('pipe-fitting', 'cleanoutStyle', 'Cleanout style', ['end', 'inline'], 'end', false, [
    'cleanout',
  ]),
  option('pipe-fitting', 'pipeMaterial', 'Material', ['pvc', 'abs', 'cast-iron'], 'pvc'),
]

for (const entry of ductFittingToolOptions) {
  if (!['diameter', 'width', 'height'].includes(entry.id)) continue
  entry.visible = {
    subscribe: (callback) => useEditor.subscribe(callback),
    value: () => {
      const defaults = useEditor.getState().toolDefaults['duct-fitting']
      const type = defaults?.fittingType ?? 'elbow'
      if (type === 'access-panel') return false
      const round = ['reducer', 'transition'].includes(String(type))
        ? (defaults?.inletShape ?? (type === 'reducer' ? 'round' : 'rect')) === 'round'
        : defaults?.shape === 'round'
      return entry.id === 'diameter' ? round : !round
    },
  }
}

for (const entry of ductFittingToolOptions) {
  if (!['branchDiameter', 'shape2', 'width2', 'height2'].includes(entry.id)) continue
  entry.visible = {
    subscribe: (callback) => useEditor.subscribe(callback),
    value: () => {
      const defaults = useEditor.getState().toolDefaults['duct-fitting']
      if (!['tee', 'cross'].includes(String(defaults?.fittingType))) return false
      const roundRun = defaults?.shape === 'round'
      const roundBranch = roundRun || defaults?.shape2 === 'round'
      if (entry.id === 'shape2') return !roundRun
      return entry.id === 'branchDiameter' ? roundBranch : !roundBranch
    },
  }
}

for (const entry of ductFittingToolOptions) {
  if (!['diameter2', 'outletWidth', 'outletHeight'].includes(entry.id)) continue
  entry.visible = {
    subscribe: (callback) => useEditor.subscribe(callback),
    value: () => {
      const defaults = useEditor.getState().toolDefaults['duct-fitting']
      if (!['reducer', 'transition'].includes(String(defaults?.fittingType))) return false
      const round = (defaults?.outletShape ?? 'round') === 'round'
      return entry.id === 'diameter2' ? round : !round
    },
  }
}
