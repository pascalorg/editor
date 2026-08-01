import { changelogPage } from '@panel/lib/changelog'
import type { Lang } from '@panel/lib/types'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Changelog' }

/**
 * A narrow, single-column release history: date, version, title, what
 * changed, tags — rows separated by rules rather than boxed into cards,
 * which is what keeps a long history readable in one scroll.
 *
 * Public, and fed by the same source as the console's Updates tab, so the
 * two can never drift. The RSS button beside the heading is the same list
 * again, for anyone who would rather be told than remember to look.
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
  const { entries } = await changelogPage(null, 40)

  return (
    <main>
      <div className="mx-auto max-w-2xl px-6 pt-20 pb-24">
        <header className="mb-16">
          <h1 className="m-0 font-bold text-[36px] text-fg leading-[1.1] tracking-[-0.025em]">
            {lang === 'tr' ? 'Sürüm notları' : 'Changelog'}
          </h1>
          <p className="mt-3 text-[15px] text-muted-fg leading-relaxed">
            {lang === 'tr'
              ? 'DigitalTwin platformundaki yeni özellikler, iyileştirmeler ve düzeltmeler.'
              : 'New features, improvements, and fixes across the DigitalTwin platform.'}
          </p>
          <div className="mt-6">
            <a
              className="inline-flex items-center gap-[6px] rounded-full border border-border bg-surface px-[14px] py-[6px] text-[12px] text-muted-fg no-underline transition-colors hover:border-border hover:text-fg"
              href="/changelog/rss.xml"
              title={lang === 'tr' ? 'RSS ile takip et' : 'Subscribe via RSS'}
            >
              <svg
                aria-hidden
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M4 11a9 9 0 0 1 9 9" />
                <path d="M4 4a16 16 0 0 1 16 16" />
                <circle cx="5" cy="19" r="1" />
              </svg>
              {lang === 'tr' ? 'Takip et' : 'Subscribe'}
            </a>
          </div>
        </header>

        <div className="divide-y divide-border">
          {entries.map((entry, index) => (
            <article className={index === 0 ? 'py-8 pt-0' : 'py-8'} key={entry.id}>
              <div className="mb-3 flex items-center gap-3">
                <time
                  className="font-mono text-[13px] text-muted-fg tabular-nums"
                  dateTime={entry.date}
                >
                  {formatDay(lang, entry.date)}
                </time>
                {entry.version ? (
                  <>
                    <span className="text-muted-fg/40">·</span>
                    <span className="font-mono text-[13px] text-muted-fg">{entry.version}</span>
                  </>
                ) : null}
              </div>

              <h2 className="m-0 font-semibold text-[22px] text-fg leading-snug tracking-[-0.015em]">
                {entry.title}
              </h2>

              <p className="mt-2 text-[15px] text-muted-fg leading-relaxed">{entry.summary}</p>

              {entry.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-[6px]">
                  {entry.tags.map((tag) => (
                    <span
                      className="rounded-full bg-muted px-[8px] py-[2px] font-mono text-[11px] text-muted-fg"
                      key={tag}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}
