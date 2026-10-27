import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright-core'
import { type PseudoSurface, surfaces } from '../i18n/pseudo-surfaces'

/**
 * Pseudo-locale audit. Opens each surface of a running editor with
 * `?lang=en-XA`, where every translated letter is accented and the text is
 * ~30 % longer and bracketed, then reports any visible text or accessible
 * name that still contains plain ASCII words: that copy bypassed the catalog.
 * Visible controls without an accessible name are reported too, so narrow
 * layouts that hide a button's text still name it.
 * Screenshots of each surface go to the output directory for clipping review.
 *
 *   bun run i18n:pseudo-audit -- --base http://localhost:3002 [--out dir] [surface...]
 *
 * Needs a Chrome/Chromium binary (`PLAYWRIGHT_CHROMIUM_EXECUTABLE`, defaulting
 * to the system Google Chrome). It is a contributor and PR tool, not a CI job.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ALLOWLIST = JSON.parse(readFileSync(join(ROOT, 'i18n/literal-allowlist.json'), 'utf8')) as {
  texts: string[]
}

export type Finding = { surface: string; where: string; text: string }

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

/** ASCII words left after removing allowed data (authored names, brands, units). */
export function untranslatedWords(text: string, allowed: readonly string[]): string[] {
  let rest = text
  for (const value of [...allowed].sort((a, b) => b.length - a.length)) {
    if (!value) continue
    // Whole words only: allowing the unit "in" must not hide "Find" or "Pin".
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu'), ' ')
  }
  return rest.match(/[A-Za-z]{2,}/g) ?? []
}

async function collect(page: Page, scope: string | undefined) {
  return page.evaluate((selector) => {
    const roots = selector ? [...document.querySelectorAll(selector)] : [document.body]
    const results: Array<{ where: string; text: string }> = []
    const describe = (element: Element) => {
      const parts: string[] = []
      for (
        let current: Element | null = element;
        current && parts.length < 3;
        current = current.parentElement
      ) {
        const id = current.id ? `#${current.id}` : ''
        const testId = current.getAttribute('data-testid')
        parts.unshift(
          `${current.tagName.toLowerCase()}${id}${testId ? `[data-testid=${testId}]` : ''}`,
        )
      }
      return parts.join(' > ')
    }
    const visible = (element: Element) =>
      element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
      !element.closest('[aria-hidden="true"], script, style, noscript, svg title')
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim()
        const parent = node.parentElement
        if (text && parent && visible(parent)) results.push({ where: describe(parent), text })
      }
      for (const element of root.querySelectorAll(
        '[aria-label], [title], [placeholder], img[alt]',
      )) {
        if (!visible(element)) continue
        for (const name of ['aria-label', 'title', 'placeholder', 'alt']) {
          const value = element.getAttribute(name)?.trim()
          if (value) results.push({ where: `${describe(element)} @${name}`, text: value })
        }
      }
    }
    const unnamed: string[] = []
    for (const root of roots) {
      for (const control of root.querySelectorAll(
        'button, a[href], [role="button"], input, select',
      )) {
        if (!visible(control)) continue
        const labelledBy = control
          .getAttribute('aria-labelledby')
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
        const name = [
          control.getAttribute('aria-label'),
          labelledBy,
          control.getAttribute('title'),
          // biome-ignore lint/performance/useDomNodeTextContent: text hidden at this width must not count as a name
          (control as HTMLElement).innerText,
          // biome-ignore lint/performance/useDomNodeTextContent: text hidden at this width must not count as a name
          (control as HTMLInputElement).labels?.[0]?.innerText,
          ...[...control.querySelectorAll('img[alt]')].map((image) => image.getAttribute('alt')),
        ]
          .map((value) => value?.trim())
          .find(Boolean)
        if (!name) unnamed.push(describe(control))
      }
    }
    return { results, unnamed }
  }, scope)
}

export async function auditSurface(page: Page, base: string, surface: PseudoSurface, out: string) {
  const findings: Finding[] = []
  const path = typeof surface.path === 'string' ? surface.path : await surface.path(base)
  const url = new URL(path, base)
  url.searchParams.set('lang', 'en-XA')
  await page.setViewportSize(surface.viewport ?? { width: 1440, height: 900 })
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined)
  await surface.steps?.(page)
  await page.waitForTimeout(400)
  const allowed = [...ALLOWLIST.texts, ...(surface.data ?? [])]
  const { results, unnamed } = await collect(page, surface.scope)
  for (const where of unnamed) {
    findings.push({ surface: surface.name, where, text: 'control has no accessible name' })
  }
  for (const entry of results) {
    const words = untranslatedWords(entry.text, allowed)
    if (words.length > 0)
      findings.push({ surface: surface.name, where: entry.where, text: entry.text })
  }
  const shot = join(out, `${surface.name}.png`)
  if (surface.scope && (await page.locator(surface.scope).count()) === 0) {
    findings.push({ surface: surface.name, where: surface.scope, text: 'surface did not open' })
  }
  await page.screenshot({ path: shot })
  return { findings, shot }
}

async function main(): Promise<void> {
  const base = argument('base') ?? 'http://localhost:3002'
  const out = resolve(argument('out') ?? join(ROOT, '.i18n-audit'))
  const wanted = process.argv
    .slice(2)
    .filter((arg, index, all) => !arg.startsWith('--') && !all[index - 1]?.startsWith('--'))
  const selected = surfaces.filter(
    (surface) => wanted.length === 0 || wanted.includes(surface.name),
  )
  if (selected.length === 0) throw new Error(`No surface matches ${wanted.join(', ')}`)
  mkdirSync(out, { recursive: true })

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/usr/local/bin/google-chrome',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const findings: Finding[] = []
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1 })
    const page = await context.newPage()
    for (const surface of selected) {
      const result = await auditSurface(page, base, surface, out)
      findings.push(...result.findings)
      console.log(
        `${result.findings.length === 0 ? 'PASS' : 'FAIL'} ${surface.name} (${result.findings.length} untranslated) → ${result.shot}`,
      )
    }
  } finally {
    await browser.close()
  }
  writeFileSync(join(out, 'findings.json'), `${JSON.stringify(findings, null, 2)}\n`)
  for (const finding of findings) {
    console.log(`  ${finding.surface}: ${JSON.stringify(finding.text)}  (${finding.where})`)
  }
  if (findings.length > 0) process.exitCode = 1
}

if (import.meta.main) await main()
