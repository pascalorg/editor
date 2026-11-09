/**
 * Turns a three.js module the model wrote (`import … from 'three'`,
 * `export const params`, `export default function build`) into a function
 * body evaluated with the modules injected. Only the allowlisted modules
 * resolve; anything else fails with the list of what is available.
 */

export type ModuleTable = Record<string, Record<string, unknown>>

const IMPORT_RE = /(?:^|(?<=;))\s*import\s+([\s\S]+?)\s+from\s+['"]([^'"]+)['"]\s*;?/gm
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

/** Before a `/`, these leave an operand expected: the slash opens a regular expression. */
const BEFORE_REGEX = new Set([...'(,=:[!&|?{};+-*%<>~^'])
const KEYWORD_BEFORE_REGEX =
  /(?:^|[^\w$])(?:return|typeof|case|in|of|new|delete|void|throw|else|do|yield|await)$/

/**
 * Which characters of a module are its own code: not inside a string, a template literal's text,
 * a comment or a regular expression. A module may carry other modules as text (an adapter writes
 * the modules of a scene), and their `import` and `export` are its data, not its statements.
 */
function codeMask(code: string): Uint8Array {
  const mask = new Uint8Array(code.length)
  // Each open template expression (`${`) keeps the brace depth it returns at.
  const templates: number[] = []
  let depth = 0
  let last = ''
  let i = 0
  const skipQuoted = (quote: string) => {
    for (i++; i < code.length && code[i] !== quote && code[i] !== '\n'; i++)
      if (code[i] === '\\') i++
    i++
  }
  /** Template text from i (just past a backtick or a closing brace) to its end or its next `${`. */
  const skipTemplate = () => {
    for (; i < code.length; i++) {
      if (code[i] === '\\') i++
      else if (code[i] === '`') {
        i++
        return
      } else if (code[i] === '$' && code[i + 1] === '{') {
        templates.push(depth)
        depth++
        i += 2
        return
      }
    }
  }
  while (i < code.length) {
    const c = code[i]!
    const next = code[i + 1]
    if (c === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i++
    } else if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2)
      i = end < 0 ? code.length : end + 2
    } else if (c === "'" || c === '"') {
      skipQuoted(c)
      last = c
    } else if (c === '`') {
      i++
      skipTemplate()
      last = '`'
    } else if (
      c === '/' &&
      (last === '' ||
        BEFORE_REGEX.has(last) ||
        KEYWORD_BEFORE_REGEX.test(code.slice(Math.max(0, i - 8), i).trimEnd()))
    ) {
      let inClass = false
      for (i++; i < code.length && code[i] !== '\n'; i++) {
        if (code[i] === '\\') i++
        else if (code[i] === '[') inClass = true
        else if (code[i] === ']') inClass = false
        else if (code[i] === '/' && !inClass) break
      }
      i++
      last = '/'
    } else if (c === '}' && templates.length && templates.at(-1) === depth - 1) {
      templates.pop()
      depth--
      i++
      skipTemplate()
      last = '`'
    } else {
      mask[i] = 1
      if (c === '{') depth++
      else if (c === '}') depth--
      if (!/\s/.test(c)) last = c
      i++
    }
  }
  return mask
}

/** `text.replace(pattern, replace)` for the matches whose first word is the module's own code. */
function replaceInCode(
  text: string,
  pattern: RegExp,
  replace: (match: string, ...groups: string[]) => string,
): string {
  const mask = codeMask(text)
  let done = false
  return text.replace(
    new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`),
    (...args) => {
      const match = args[0] as string
      const offset = args.at(-2) as number
      if ((done && !pattern.global) || !mask[offset + match.search(/\S/)]) return match
      done = true
      return replace(match, ...(args.slice(1, -2) as string[]))
    },
  )
}

export function transformModule(code: string, modules: ModuleTable): string {
  const unknown: string[] = []
  let body = replaceInCode(code, IMPORT_RE, (_all, clause, specifier) => {
    const key = moduleKey(specifier!)
    if (!key || !(key in modules)) {
      unknown.push(specifier!)
      return ''
    }
    return bindingsFor(clause!, `__modules[${JSON.stringify(key)}]`)
  })
  body = replaceInCode(body, SIDE_EFFECT_IMPORT_RE, () => '')
  if (unknown.length > 0) {
    const available = Object.keys(modules)
      .map((key) => (key === 'three' || key === 'three-bvh-csg' ? key : `three/addons/…/${key}.js`))
      .join(', ')
    throw new Error(`Unsupported import ${unknown.join(', ')}. Available: ${available}.`)
  }
  body = replaceInCode(
    body,
    /export\s+default\s+(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/,
    (_m, a, n) =>
      n ? `const __default = ${a ?? ''}function ${n}(` : `const __default = ${a ?? ''}function (`,
  )
  body = replaceInCode(body, /export\s+default\s+/, () => 'const __default = ')
  body = replaceInCode(body, /export\s+(const|let|var|function|class)\s/g, (_m, kind) => `${kind} `)
  body = replaceInCode(body, /export\s*\{[^}]*\}\s*;?/g, () => '')
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
