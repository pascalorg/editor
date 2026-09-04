import { changelogPage } from '@panel/lib/changelog'
import { appUrl } from '@panel/lib/mail'

export const dynamic = 'force-dynamic'

/** Escapes the five characters XML cannot carry raw. */
function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * GET /changelog/rss.xml — the same entries the changelog page shows, for
 * readers who would rather be told than remember to look.
 */
export async function GET() {
  const { entries } = await changelogPage(null, 40)
  const site = appUrl('/changelog')

  const items = entries
    .map((entry) => {
      const title = entry.version ? `${entry.version} — ${entry.title}` : entry.title
      return `    <item>
      <title>${xml(title)}</title>
      <link>${xml(site)}</link>
      <guid isPermaLink="false">${xml(entry.id)}</guid>
      <pubDate>${new Date(entry.date).toUTCString()}</pubDate>
      <description>${xml(entry.summary)}</description>
${entry.tags.map((tag) => `      <category>${xml(tag)}</category>`).join('\n')}
    </item>`
    })
    .join('\n')

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>DigitalTwin — changelog</title>
    <link>${xml(site)}</link>
    <description>Releases and changes across the DigitalTwin platform.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`

  return new Response(body, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
