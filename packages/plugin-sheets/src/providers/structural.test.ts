import { test } from 'bun:test'
import fixture from '../__fixtures__/plancrafters-cottage.json'
import { computeLevel } from '../../../plugin-bones/src/framing/compute'
import { FramingNode } from '../../../plugin-bones/src/framing/schema'

function run(jur: string, extra: Record<string, unknown> = {}) {
  const nodes = (fixture as unknown as { graph: { nodes: Record<string, any> } }).graph.nodes
  const level = Object.values(nodes).find((n: any) => n.type === 'level') as any
  const cfg = FramingNode.parse({
    id: `bonesframing_probe_${jur}_${JSON.stringify(extra)}`,
    type: 'bones:framing',
    parentId: level.id,
    jurisdiction: jur,
    ...extra,
  })
  return computeLevel(nodes as any, cfg as any)
}

function dump(r: any, system: string, roles?: string[]) {
  const seen = new Set<string>()
  for (const m of r.members) {
    if (m.system !== system) continue
    if (roles && !roles.includes(m.role)) continue
    const key = `${m.role}|${m.size ?? ''}|${m.label ?? ''}|${m.flag ?? ''}|${m.advisory ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    console.log(
      m.role,
      '| size', m.size,
      '| dims', m.dims.map((d: number) => d.toFixed(3)).join(','),
      '| pos', m.position.map((d: number) => d.toFixed(2)).join(','),
      '| rot', m.rotation.map((d: number) => d.toFixed(3)).join(','),
      '| label', m.label,
      '| flag', m.flag,
      '| adv', m.advisory,
    )
  }
}

test('roof-framing FL stick', () => {
  const r = run('FL')
  dump(r, 'roof-framing')
})

test('roof-framing truss', () => {
  const r = run('FL', { roofSystem: 'truss' })
  const byRole: Record<string, number> = {}
  for (const m of r.members) byRole[`${m.system}/${m.role}`] = (byRole[`${m.system}/${m.role}`] || 0) + 1
  console.log(byRole)
  dump(r, 'roof-framing')
  console.log('warnings', r.warnings)
})

test('wall-framing headers FL', () => {
  const r = run('FL')
  dump(r, 'wall-framing', ['header', 'lintel', 'post'])
})
