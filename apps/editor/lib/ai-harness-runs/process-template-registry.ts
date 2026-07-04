import {
  applyFactoryArchitectureToPlan,
  loadCloudIndustryProcessTemplates,
  loadIndustryProcessTemplates,
} from './industry-factory-knowledge'
import type {
  ProcessConnectionPlan,
  ProcessLineDomain,
  ProcessLineLayoutStyle,
  ProcessLinePlan,
  ProcessStationPlan,
} from './process-line-types'

export type ProcessTemplate = {
  processId: string
  processLabel: string
  processDisplayLabel?: string
  domain: ProcessLineDomain
  aliases: RegExp[]
  requiredRoles: string[]
  defaultLayoutStyle: ProcessLineLayoutStyle
  defaultDimensions: { length: number; width: number }
  safetyTags: string[]
  stations: ProcessStationPlan[]
  connections: ProcessConnectionPlan[]
  sourcePack?: {
    id: string
    version: string
    industry: string
  }
}

const WATER_ELECTROLYSIS_STATIONS: ProcessStationPlan[] = [
  {
    id: 'water_treatment',
    label: 'Pure water treatment',
    role: 'water_treatment',
    equipmentHint: 'skid-mounted pure water treatment module with feed tank and filters',
    footprintHint: 'medium',
    safetyTags: ['water'],
  },
  {
    id: 'electrolyzer',
    label: 'Electrolyzer stack array',
    role: 'electrolyzer',
    equipmentHint: 'industrial water electrolysis electrolyzer stack array module',
    footprintHint: 'long',
    safetyTags: ['hydrogen', 'oxygen'],
  },
  {
    id: 'dc_power_supply',
    label: 'DC power supply',
    role: 'dc_power_supply',
    equipmentHint: 'industrial rectifier DC power cabinet for electrolyzer',
    footprintHint: 'medium',
    safetyTags: ['power'],
  },
  {
    id: 'hydrogen_separator',
    label: 'Hydrogen gas-liquid separator',
    role: 'hydrogen_separator',
    equipmentHint: 'vertical hydrogen gas liquid separator vessel',
    footprintHint: 'tall',
    safetyTags: ['hydrogen'],
  },
  {
    id: 'oxygen_separator',
    label: 'Oxygen gas-liquid separator',
    role: 'oxygen_separator',
    equipmentHint: 'vertical oxygen gas liquid separator vessel',
    footprintHint: 'tall',
    safetyTags: ['oxygen'],
  },
  {
    id: 'hydrogen_buffer',
    label: 'Hydrogen drying and buffer tank',
    role: 'hydrogen_buffer',
    equipmentHint: 'hydrogen drying skid and buffer storage tank',
    footprintHint: 'large',
    safetyTags: ['hydrogen'],
  },
  {
    id: 'cooling_loop',
    label: 'Cooling water loop',
    role: 'cooling_loop',
    equipmentHint: 'industrial cooling water circulation skid with pump and heat exchanger',
    footprintHint: 'medium',
    safetyTags: ['cooling'],
  },
  {
    id: 'control_and_safety',
    label: 'Control and safety monitoring',
    role: 'control_and_safety',
    equipmentHint: 'control cabinet with gas detection alarm and ventilation monitoring',
    footprintHint: 'medium',
    safetyTags: ['monitoring', 'ventilation'],
  },
]

const WATER_ELECTROLYSIS_CONNECTIONS: ProcessConnectionPlan[] = [
  {
    fromStationId: 'water_treatment',
    toStationId: 'electrolyzer',
    medium: 'water',
    visualKind: 'pipe',
  },
  {
    fromStationId: 'dc_power_supply',
    toStationId: 'electrolyzer',
    medium: 'power',
    visualKind: 'cable_tray',
  },
  {
    fromStationId: 'electrolyzer',
    toStationId: 'hydrogen_separator',
    medium: 'hydrogen',
    visualKind: 'pipe',
  },
  {
    fromStationId: 'electrolyzer',
    toStationId: 'oxygen_separator',
    medium: 'oxygen',
    visualKind: 'pipe',
  },
  {
    fromStationId: 'electrolyzer',
    toStationId: 'cooling_loop',
    medium: 'cooling',
    visualKind: 'pipe',
  },
  {
    fromStationId: 'hydrogen_separator',
    toStationId: 'hydrogen_buffer',
    medium: 'hydrogen',
    visualKind: 'pipe',
  },
]

export const PROCESS_TEMPLATES: ProcessTemplate[] = [
  {
    processId: 'water_electrolysis_hydrogen',
    processLabel: 'Water electrolysis hydrogen workshop',
    domain: 'energy',
    aliases: [
      /\u6c34\u88c2\u89e3/,
      /\u7535\u89e3\u6c34/,
      /\u5236\u6c22/,
      /\u6c22\u6c14/,
      /\bhydrogen\b/i,
      /\belectrolys(is|er|zer)\b/i,
    ],
    requiredRoles: WATER_ELECTROLYSIS_STATIONS.map((station) => station.role),
    defaultLayoutStyle: 'linear',
    defaultDimensions: { length: 24, width: 9 },
    safetyTags: ['hydrogen', 'oxygen', 'ventilation', 'monitoring'],
    stations: WATER_ELECTROLYSIS_STATIONS,
    connections: WATER_ELECTROLYSIS_CONNECTIONS,
  },
]

export function allProcessTemplates(): ProcessTemplate[] {
  return [...PROCESS_TEMPLATES, ...loadIndustryProcessTemplates()]
}

function isFactoryScopePrompt(prompt: string) {
  return /\u5de5\u5382|\u5382|\u8f66\u95f4|\bfactory\b|\bplant\b|\bworkshop\b|\bsmelter\b/i.test(
    prompt,
  )
}

function isWholeFactoryTemplate(template: ProcessTemplate) {
  return (
    /\b(full|factory|plant|smelter|workshop)\b/i.test(template.processId) ||
    /\b(full|factory|plant|smelter|workshop)\b/i.test(template.processLabel) ||
    /\u5de5\u5382|\u8f66\u95f4/.test(template.processDisplayLabel ?? '')
  )
}

export function matchProcessTemplate(prompt: string): ProcessTemplate | undefined {
  const matches = allProcessTemplates().filter((template) =>
    template.aliases.some((pattern) => pattern.test(prompt)),
  )
  if (isFactoryScopePrompt(prompt)) {
    return matches.find(isWholeFactoryTemplate) ?? matches[0]
  }
  return matches[0]
}

export function matchUnavailableProcessTemplate(prompt: string): ProcessTemplate | undefined {
  const availableKeys = new Set(
    allProcessTemplates().map(
      (template) =>
        `${template.sourcePack?.id ?? 'builtin'}@${template.sourcePack?.version ?? '0.0.0'}:${template.processId}`,
    ),
  )
  const matches = loadCloudIndustryProcessTemplates()
    .filter(
      (template) =>
        !availableKeys.has(
          `${template.sourcePack?.id ?? 'builtin'}@${template.sourcePack?.version ?? '0.0.0'}:${template.processId}`,
        ),
    )
    .filter((template) => template.aliases.some((pattern) => pattern.test(prompt)))
  if (isFactoryScopePrompt(prompt)) {
    return matches.find(isWholeFactoryTemplate) ?? matches[0]
  }
  return matches[0]
}

export function buildProcessLinePlanFromTemplate(
  template: ProcessTemplate,
  prompt?: string,
): ProcessLinePlan {
  const plan: ProcessLinePlan = {
    processId: template.processId,
    processLabel: template.processLabel,
    ...(template.processDisplayLabel ? { processDisplayLabel: template.processDisplayLabel } : {}),
    ...(template.sourcePack ? { sourcePack: { ...template.sourcePack } } : {}),
    domain: template.domain,
    layoutStyle: template.defaultLayoutStyle,
    dimensions: template.defaultDimensions,
    stations: template.stations.map((station) => ({ ...station })),
    connections: template.connections.map((connection) => ({ ...connection })),
    safetyTags: [...template.safetyTags],
  }
  return prompt ? applyFactoryArchitectureToPlan({ plan, prompt }) : plan
}
