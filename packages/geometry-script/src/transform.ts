/**
 * Turns a three.js module the model wrote (`import … from 'three'`,
 * `export const params`, `export default function build`) into a function
 * body evaluated with the modules injected. Only the allowlisted modules
 * resolve; anything else fails with the list of what is available.
 */

export type ModuleTable = Record<string, Record<string, unknown>>

const IMPORT_RE = /^\s*import\s+([\s\S]+?)\s+from\s+['"]([^'"]+)['"]\s*;?/gm
const SIDE_EFFECT_IMPORT_RE = /^\s*import\s+['"][^'"]+['"]\s*;?/gm

export function moduleKey(specifier: string): string | null {
  if (specifier === 'three') return 'three'
  if (specifier === 'three-bvh-csg') return 'three-bvh-csg'
  const addon = specifier.match(/^three\/(?:addons|examples\/jsm)\/(?:.+\/)?([^/]+?)(?:\.js)?$/)
  return addon ? addon[1]! : null
}

function bindingsFor(clause: string, moduleRef: string): string {
  const out: string[] = []
  let rest = clause.trim()
  const namespace = rest.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/)
  if (namespace) return `const ${namespace[1]} = ${moduleRef};`
  const named = rest.match(/\{([\s\S]*)\}/)
  if (named) {
    const specs = named[1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [imported, local] = s.split(/\s+as\s+/).map((p) => p.trim())
        return local ? `${imported}: ${local}` : imported!
      })
    out.push(`const { ${specs.join(', ')} } = ${moduleRef};`)
    rest = rest.replace(named[0], '').replace(/,\s*$/, '').replace(/^\s*,/, '').trim()
  }
  const defaultName = rest.replace(/,$/, '').trim()
  if (defaultName) {
    out.push(`const ${defaultName} = ${moduleRef}.default ?? ${moduleRef};`)
  }
  return out.join(' ')
}

export function transformModule(code: string, modules: ModuleTable): string {
  const unknown: string[] = []
  let body = code.replace(IMPORT_RE, (_all, clause: string, specifier: string) => {
    const key = moduleKey(specifier)
    if (!key || !(key in modules)) {
      unknown.push(specifier)
      return ''
    }
    return bindingsFor(clause, `__modules[${JSON.stringify(key)}]`)
  })
  body = body.replace(SIDE_EFFECT_IMPORT_RE, '')
  if (unknown.length > 0) {
    const available = Object.keys(modules)
      .map((key) => (key === 'three' || key === 'three-bvh-csg' ? key : `three/addons/…/${key}.js`))
      .join(', ')
    throw new Error(`Unsupported import ${unknown.join(', ')}. Available: ${available}.`)
  }
  body = body
    .replace(
      /export\s+default\s+(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/,
      (_m, a, n) =>
        n ? `const __default = ${a ?? ''}function ${n}(` : `const __default = ${a ?? ''}function (`,
    )
    .replace(/export\s+default\s+/, 'const __default = ')
    .replace(/export\s+(const|let|var|function|class)\s/g, '$1 ')
    .replace(/export\s*\{[^}]*\}\s*;?/g, '')
  // A block scope lets `import * as THREE from 'three'` shadow the injected THREE.
  return `{
${body}
return {
  build: typeof __default !== 'undefined' ? __default : typeof build !== 'undefined' ? build : undefined,
  params: typeof params !== 'undefined' ? params : undefined,
  mount: typeof mount !== 'undefined' ? mount : undefined,
};
}`
}
