import { changelogPage } from '@panel/lib/changelog'
import { dictionaryFor } from '@panel/lib/i18n'
import type { Lang } from '@panel/lib/types'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Changelog' }

/**
 * The changelog as a plain reverse-chronological list: date, version, title,
 * what changed, and the tags — separated by rules rather than boxed into
 * cards, which is what makes a long release history readable in one scroll.
 *
 * Public on purpose, and fed by the same source as the console's Updates
 * tab, so the two can never drift. The RSS feed beside the heading is the
 * same list again, for anyone who would rather be told than remember.
 */
function formatDay(lang: Lang, iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export default async function ChangelogPage() {
  const jar = await cookies()
  const lang: Lang = jar.get('digitaltwin_lang')?.value === 'tr' ? 'tr' : 'en'
  const t = dictionaryFor(lang)
  const { entries } = await changelogPage(null, 40)

  const channelLabel = (channel: string) =>
    channel === 'editor' ? t.clEditor : channel === 'console' ? t.clConsole : t.clPlugin

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="m-0 font-semibold text-[30px] leading-[1.15] tracking-[-0.02em]">
          {lang === 'tr' ? 'Sürüm notları' : 'Changelog'}
        </h1>
        <a
          className="font-mono text-[11px] text-muted-fg no-underline hover:text-fg"
          href="/changelog/rss.xml"
        >
          {lang === 'tr' ? 'RSS ile takip et' : 'Subscribe via RSS'}
        </a>
      </header>

      <div className="flex flex-col">
        {entries.map((entry, index) => (
          <section
            className={`flex flex-col gap-[7px] py-7 ${
              index === 0 ? 'pt-0' : 'border-border border-t'
            }`}
            key={entry.id}
          >
            <div className="flex flex-wrap items-baseline gap-[10px]">
              <time className="font-mono text-[11.5px] text-muted-fg" dateTime={entry.date}>
                {formatDay(lang, entry.date)}
              </time>
              {entry.version ? (
                <span className="font-mono text-[11.5px] text-brand-fg">{entry.version}</span>
              ) : null}
              <span className="font-mono text-[10px] text-muted-fg">
                {channelLabel(entry.channel)}
              </span>
            </div>

            <h2 className="m-0 font-semibold text-[19px] leading-[1.3] tracking-[-0.015em]">
              {entry.title}
            </h2>

            <p className="m-0 text-[13.5px] text-muted-fg leading-[1.7]">{entry.summary}</p>

            {entry.tags.length > 0 ? (
              <p className="m-0 flex flex-wrap gap-[10px] font-mono text-[11px] text-muted-fg">
                {entry.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </article>
  )
}
