import type { ShikiTransformer } from 'shiki'
import { codeToHtml } from 'shiki'

const lineNumberTransformer: ShikiTransformer = {
  pre(node) {
    const current = String(node.properties?.class ?? '')
    node.properties = {
      ...node.properties,
      class: `${current} code-scroll`.trim(),
    }
  },
  code(node) {
    node.properties = {
      ...node.properties,
      'data-line-numbers': '',
    }
  },
  line(node) {
    node.properties = {
      ...node.properties,
      'data-line': '',
    }
  },
}

export async function highlightCode(code: string, lang: string) {
  return codeToHtml(code, {
    lang,
    themes: {
      light: 'github-light',
      dark: 'github-dark',
    },
    defaultColor: false,
    transformers: [lineNumberTransformer],
  })
}
