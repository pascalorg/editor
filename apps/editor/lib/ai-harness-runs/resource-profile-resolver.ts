import type { DeviceProfileDefinition } from '@pascal-app/core/lib/device-profile-registry'

export type ProfileResourceCandidate = {
  profile: DeviceProfileDefinition
  score: number
  matchedLabel: string
  matchKind: 'id' | 'name' | 'alias' | 'description' | 'part'
  reason: string
}

export type ProfileResourceResolution = {
  candidates: ProfileResourceCandidate[]
  selectedProfile?: DeviceProfileDefinition
  selectedCandidate?: ProfileResourceCandidate
}

type LabelSource = {
  label: string
  kind: ProfileResourceCandidate['matchKind']
  weight: number
}

function compactText(value: unknown): string {
  return typeof value === 'string'
    ? value
        .toLowerCase()
        .replace(/[_\s\p{P}\p{S}]+/gu, '')
        .trim()
    : ''
}

function tokenText(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .toLowerCase()
        .replace(/[_\p{P}\p{S}]+/gu, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
    : []
}

function cjkSegments(value: string): string[] {
  return value.match(/[\u3400-\u9fff]+/g) ?? []
}

function longestCommonSubstring(left: string, right: string): string {
  if (!left || !right) return ''
  const previous = new Array<number>(right.length + 1).fill(0)
  const current = new Array<number>(right.length + 1).fill(0)
  let bestLength = 0
  let bestEnd = 0

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      if (left[leftIndex - 1] === right[rightIndex - 1]) {
        const length = (previous[rightIndex - 1] ?? 0) + 1
        current[rightIndex] = length
        if (length > bestLength) {
          bestLength = length
          bestEnd = leftIndex
        }
      } else {
        current[rightIndex] = 0
      }
    }
    previous.splice(0, previous.length, ...current)
    current.fill(0)
  }

  return bestLength > 0 ? left.slice(bestEnd - bestLength, bestEnd) : ''
}

function longestCommonCjkTerm(query: string, label: string): string {
  let best = ''
  for (const querySegment of cjkSegments(query)) {
    for (const labelSegment of cjkSegments(label)) {
      const common = longestCommonSubstring(querySegment, labelSegment)
      if (common.length > best.length) best = common
    }
  }
  return best
}

function labelSources(profile: DeviceProfileDefinition): LabelSource[] {
  return [
    { label: profile.id, kind: 'id', weight: 0.98 },
    { label: profile.name, kind: 'name', weight: 0.95 },
    ...profile.aliases.map((label) => ({ label, kind: 'alias' as const, weight: 1 })),
    { label: profile.description, kind: 'description', weight: 0.68 },
    ...profile.parts.flatMap((part) =>
      [part.semanticRole, part.kind]
        .filter((label): label is string => typeof label === 'string' && label.length > 0)
        .map((label) => ({ label, kind: 'part' as const, weight: 0.5 })),
    ),
  ]
}

function scoreLabel(query: string, queryTokens: readonly string[], source: LabelSource) {
  const label = compactText(source.label)
  if (!query || !label) return undefined

  if (query === label) {
    return {
      score: source.weight,
      reason: `${source.kind} exact match`,
    }
  }
  if (query.includes(label) && label.length >= 2) {
    return {
      score: Math.min(source.weight, source.kind === 'alias' ? 0.97 : 0.9),
      reason: `${source.kind} contained in request`,
    }
  }
  if (label.includes(query) && query.length >= 2) {
    return {
      score: Math.min(source.weight, source.kind === 'alias' ? 0.78 : 0.7),
      reason: `request contained in ${source.kind}`,
    }
  }

  const commonCjkTerm = longestCommonCjkTerm(query, label)
  if (commonCjkTerm.length >= 3) {
    const labelCjkLength = cjkSegments(label).join('').length
    const overlapRatio = labelCjkLength > 0 ? commonCjkTerm.length / labelCjkLength : 0
    if (overlapRatio >= 0.5) {
      return {
        score: Math.min(source.weight, source.kind === 'alias' ? 0.78 : 0.68),
        reason: `${source.kind} common CJK term`,
      }
    }
  }

  const labelTokens = tokenText(source.label)
  if (queryTokens.length === 0 || labelTokens.length === 0) return undefined
  const overlap = labelTokens.filter((token) => queryTokens.includes(token))
  if (overlap.length === 0) return undefined
  const ratio = overlap.length / Math.max(labelTokens.length, 1)
  if (ratio < 0.5) return undefined
  return {
    score: Math.min(source.weight, 0.42 + ratio * 0.34),
    reason: `${source.kind} token overlap`,
  }
}

function bestCandidateForProfile(
  prompt: string,
  profile: DeviceProfileDefinition,
): ProfileResourceCandidate | undefined {
  const query = compactText(prompt)
  const queryTokens = tokenText(prompt)
  let best: ProfileResourceCandidate | undefined

  for (const source of labelSources(profile)) {
    const scored = scoreLabel(query, queryTokens, source)
    if (!scored) continue
    const candidate: ProfileResourceCandidate = {
      profile,
      score: scored.score,
      matchedLabel: source.label,
      matchKind: source.kind,
      reason: scored.reason,
    }
    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.matchedLabel.length > best.matchedLabel.length)
    ) {
      best = candidate
    }
  }

  return best
}

function shouldAutoSelect(candidates: readonly ProfileResourceCandidate[]) {
  const [first, second] = candidates
  if (!first || first.profile.status !== 'stable') return false
  if (first.score >= 0.95) return !second || first.score - second.score >= 0.04
  return first.score >= 0.88 && (!second || first.score - second.score >= 0.12)
}

function explicitProfileIdCandidate(
  prompt: string,
  profiles: readonly DeviceProfileDefinition[],
): ProfileResourceCandidate | undefined {
  const normalizedPrompt = prompt.toLowerCase()
  const matches = profiles
    .filter((profile) => normalizedPrompt.includes(profile.id.toLowerCase()))
    .sort((left, right) => right.id.length - left.id.length)
  const profile = matches[0]
  if (!profile) return undefined
  return {
    profile,
    score: 1,
    matchedLabel: profile.id,
    matchKind: 'id',
    reason: 'explicit profile id',
  }
}

export function resolveProfileResourceCandidates(
  prompt: string,
  profiles: readonly DeviceProfileDefinition[],
  limit = 8,
): ProfileResourceResolution {
  const explicitCandidate = explicitProfileIdCandidate(prompt, profiles)
  const candidates = profiles
    .map((profile) => bestCandidateForProfile(prompt, profile))
    .filter((candidate): candidate is ProfileResourceCandidate => Boolean(candidate))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      if (left.profile.sourcePack && !right.profile.sourcePack) return -1
      if (right.profile.sourcePack && !left.profile.sourcePack) return 1
      const rightLabelLength = compactText(right.matchedLabel).length
      const leftLabelLength = compactText(left.matchedLabel).length
      if (rightLabelLength !== leftLabelLength) return rightLabelLength - leftLabelLength
      return left.profile.id.localeCompare(right.profile.id)
    })
    .slice(0, limit)

  const visibleCandidates =
    explicitCandidate &&
    !candidates.some((candidate) => candidate.profile.id === explicitCandidate.profile.id)
      ? [explicitCandidate, ...candidates].slice(0, limit)
      : candidates
  const selectedCandidate =
    explicitCandidate ?? (shouldAutoSelect(visibleCandidates) ? visibleCandidates[0] : undefined)
  return {
    candidates: visibleCandidates,
    selectedCandidate,
    selectedProfile: selectedCandidate?.profile,
  }
}
