#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

const roots = ['apps', 'packages', 'tools', 'scripts']
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.md', '.css', '.html'])
const ignoredDirs = new Set(['node_modules', 'dist', '.next', '.generated', 'coverage'])

const suspiciousPatterns = [
  { name: 'replacement-character', pattern: /\uFFFD/ },
  { name: 'gbk-replacement', pattern: /锟/ },
  { name: 'utf8-as-latin1', pattern: /(?:Ã|Â|â€|â€™|â€œ|â€�|â€“|â€”)/ },
  { name: 'utf8-as-cjk', pattern: /(?:鐢|熸|垚|涓€|閻|鈧|濞|娉|鏀|閽|鐨|灞|瀣|鎼|顏|愶紝|€\?)/ },
  { name: 'private-use-leak', pattern: /[\uE000-\uF8FF]/ },
  { name: 'cyrillic-punctuation-mojibake', pattern: /(?:бк|бн|б·)/ },
  { name: 'question-mark-run-in-string', pattern: /(['"`])(?:(?!\1).)*\?{4,}(?:(?!\1).)*\1/ },
]

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(path)
    } else if (entry.isFile() && extensions.has(extname(entry.name))) {
      yield path
    }
  }
}

const findings = []

for (const root of roots) {
  if (!existsSync(root)) continue
  for (const file of walk(root)) {
    if (file.replaceAll('\\', '/') === 'scripts/check-mojibake.mjs') continue
    const text = readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/)
    lines.forEach((line, index) => {
      for (const { name, pattern } of suspiciousPatterns) {
        if (pattern.test(line)) {
          findings.push({
            file,
            line: index + 1,
            rule: name,
            text: line.trim().slice(0, 240),
          })
          break
        }
      }
    })
  }
}

if (findings.length > 0) {
  console.error(`Mojibake check failed: ${findings.length} suspicious line(s).`)
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.rule}] ${finding.text}`)
  }
  process.exit(1)
}

console.log('Mojibake check passed.')
