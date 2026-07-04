export type IndustryPackInstallState = 'installed' | 'missing'

export type InstalledIndustryPackLike = {
  id: string
  version?: string
  enabled?: boolean
}

export type IndustryPackRequirement = {
  id: string
  version: string
  industry: string
  label: string
  installState: IndustryPackInstallState
  installed: boolean
  reason: string
  matchedKeyword: string
}

type KnownIndustryPackIntent = {
  id: string
  version: string
  industry: string
  label: string
  keywords: readonly RegExp[]
}

const knownIndustryPackIntents: readonly KnownIndustryPackIntent[] = [
  {
    id: 'industry.refinery.basic',
    version: '0.1.0',
    industry: 'refinery',
    label: 'Refinery',
    keywords: [/炼油厂/iu, /炼油/iu, /\brefinery\b/iu, /\boil refinery\b/iu],
  },
  {
    id: 'industry.cement.basic',
    version: '0.1.0',
    industry: 'cement',
    label: 'Cement Plant',
    keywords: [/水泥厂/iu, /水泥/iu, /\bcement\b/iu],
  },
  {
    id: 'industry.thermal-power.basic',
    version: '0.1.0',
    industry: 'thermal-power',
    label: 'Thermal Power Plant',
    keywords: [/火电厂/iu, /火力发电/iu, /\bthermal power\b/iu, /\bpower plant\b/iu],
  },
  {
    id: 'industry.water-treatment.basic',
    version: '0.1.0',
    industry: 'water-treatment',
    label: 'Water Treatment Plant',
    keywords: [/水处理/iu, /污水处理/iu, /\bwater treatment\b/iu, /\bwastewater\b/iu],
  },
  {
    id: 'industry.discrete-manufacturing.basic',
    version: '0.1.0',
    industry: 'discrete-manufacturing',
    label: 'Discrete Manufacturing',
    keywords: [/离散制造/iu, /装配车间/iu, /\bdiscrete manufacturing\b/iu],
  },
  {
    id: 'industry.electrolytic-aluminum.basic',
    version: '0.1.0',
    industry: 'electrolytic-aluminum',
    label: 'Electrolytic Aluminum',
    keywords: [/电解铝/iu, /铝厂/iu, /\belectrolytic aluminum\b/iu, /\baluminum smelter\b/iu],
  },
  {
    id: 'industry.appliance-assembly.basic',
    version: '0.1.0',
    industry: 'appliance-assembly',
    label: 'Appliance Assembly',
    keywords: [/家电装配/iu, /家电工厂/iu, /\bappliance assembly\b/iu],
  },
  {
    id: 'industry.process.basic',
    version: '0.1.0',
    industry: 'process',
    label: 'Process Plant',
    keywords: [/流程工厂/iu, /流程行业/iu, /\bprocess plant\b/iu, /\bprocess line\b/iu],
  },
]

export function knownIndustryPackRequirements() {
  return knownIndustryPackIntents.map(({ id, version, industry, label }) => ({
    id,
    version,
    industry,
    label,
  }))
}

export function resolveIndustryPackRequirement(input: {
  prompt: string
  installedPacks?: readonly InstalledIndustryPackLike[]
}): IndustryPackRequirement | null {
  const prompt = input.prompt.trim()
  if (!prompt) return null

  for (const intent of knownIndustryPackIntents) {
    const matchedKeyword = findMatchedKeyword(prompt, intent.keywords)
    if (!matchedKeyword) continue

    const installed = isIndustryPackInstalled(intent, input.installedPacks ?? [])
    return {
      id: intent.id,
      version: intent.version,
      industry: intent.industry,
      label: intent.label,
      installState: installed ? 'installed' : 'missing',
      installed,
      reason: installed
        ? `Prompt matches ${intent.label}; required industry pack is installed.`
        : `Prompt matches ${intent.label}; install ${intent.id}@${intent.version} before generating this factory.`,
      matchedKeyword,
    }
  }

  return null
}

function findMatchedKeyword(prompt: string, keywords: readonly RegExp[]) {
  for (const keyword of keywords) {
    keyword.lastIndex = 0
    const match = keyword.exec(prompt)
    if (match?.[0]) return match[0]
  }
  return null
}

function isIndustryPackInstalled(
  intent: KnownIndustryPackIntent,
  installedPacks: readonly InstalledIndustryPackLike[],
) {
  return installedPacks.some(
    (pack) =>
      pack.id === intent.id &&
      pack.enabled !== false &&
      (!pack.version || pack.version === intent.version),
  )
}
