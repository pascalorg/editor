import { Marked, type Tokens } from 'marked'

import { highlightCode } from '@/lib/highlight'

const HIGHLIGHT_LANGS = new Set(['ts', 'tsx', 'js', 'jsx', 'json', 'html', 'sh', 'bash'])

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

const marked = new Marked({
  async: true,
  gfm: true,
  walkTokens: async (token) => {
    if (token.type !== 'code') {
      return
    }
    const code = token as Tokens.Code
    const lang = code.lang && HIGHLIGHT_LANGS.has(code.lang) ? code.lang : 'text'
    const html = await highlightCode(code.text, lang === 'text' ? 'txt' : lang)
    code.text = `<figure class="code-surface docs-prose-code" data-lang="${lang}">${html}</figure>`
    code.escaped = true
  },
  renderer: {
    code(token) {
      // walkTokens already replaced the text with highlighted HTML.
      return token.text
    },
    heading(token) {
      const inner = this.parser.parseInline(token.tokens)
      const id = slugify(token.text)
      return `<h${token.depth} id="${id}">${inner}</h${token.depth}>`
    },
  },
})

/**
 * Render a docs markdown section for a standalone HTML page: the leading
 * section heading is dropped (the page shell renders the h1), remaining
 * headings shift up one level so the outline stays h1 > h2 > h3.
 */
export async function renderDocsSectionHtml(markdown: string) {
  const withoutHeading = markdown.replace(/^#{1,2} [^\n]+\n+/, '')
  const shifted = withoutHeading.replace(
    /^(#{3,6}) /gm,
    (_, hashes: string) => `${hashes.slice(1)} `,
  )
  return await marked.parse(shifted)
}
