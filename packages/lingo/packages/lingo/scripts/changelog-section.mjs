// Extract one version's section from CHANGELOG.md for GitHub release notes.
//
//   node scripts/changelog-section.mjs 0.4.0            # → stdout
//   node scripts/changelog-section.mjs 0.4.0 --out f.md # → file
//
// The body is everything between that version's `## [x.y.z]` heading and the
// next `## [` heading, heading line excluded. Exits 1 when the section is
// missing or empty so the release workflow can fall back to --generate-notes
// instead of publishing a release with a blank body.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [version, ...rest] = process.argv.slice(2)
if (!version) {
  process.stderr.write(
    'usage: changelog-section.mjs <version> [--out <file>] [--changelog <file>]\n',
  )
  process.exit(2)
}

const flag = (name) => {
  const i = rest.indexOf(name)
  return i === -1 ? undefined : rest[i + 1]
}

const changelogPath = resolve(flag('--changelog') ?? 'CHANGELOG.md')
const source = readFileSync(changelogPath, 'utf8')

// Match `## [1.2.3]` with any trailing date/suffix. The version is escaped
// because it reaches us as an argument, not a literal.
const heading = new RegExp(
  String.raw`^## \[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\][^\n]*$`,
  'm',
)
const start = source.match(heading)
if (!start) {
  process.stderr.write(`changelog-section: no "## [${version}]" heading in ${changelogPath}\n`)
  process.exit(1)
}

const bodyStart = start.index + start[0].length
const next = source.slice(bodyStart).search(/^## \[/m)
const body = source.slice(bodyStart, next === -1 ? undefined : bodyStart + next).trim()

if (!body) {
  process.stderr.write(`changelog-section: "## [${version}]" section is empty\n`)
  process.exit(1)
}

const out = flag('--out')
if (out) {
  writeFileSync(out, `${body}\n`)
  process.stderr.write(`changelog-section: wrote ${body.length} chars to ${out}\n`)
} else {
  process.stdout.write(`${body}\n`)
}
