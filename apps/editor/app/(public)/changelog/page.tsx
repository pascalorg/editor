import { changelogPage } from '@panel/lib/changelog'
import { dictionaryFor, formatDate } from '@panel/lib/i18n'
import type { Lang } from '@panel/lib/types'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Changelog' }

/**
 * The changelog, readable without an account — the console keeps its own
 * copy behind the sign-in for admins reviewing a rollout, and both read the
 * same source, so they can never drift.
 */
export default async function ChangelogPage() {
  const jar = await cookies()
  const lang: Lang = jar.get('digitaltwin_lang')?.value === 'tr' ? 'tr' : 'en'
  const t = dictionaryFor(lang)
  const { entries } = await changelogPage(null, 30)

  const channelLabel = (channel: string) =>
    channel === 'editor' ? t.clEditor : channel === 'console' ? t.clConsole : t.clPlugin

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-[6px]">
        <h1 className="m-0 font-semibold text-[22px] tracking-[-0.015em]">{t.qlChangelog}</h1>
        <p className="m-0 text-[13.5px] text-muted-fg leading-[1.6]">{t.c.changelogLead}</p>
      </header>

      <ol className="m-0 flex list-none flex-col gap-[10px] p-0">
        {entries.map((entry) => (
          <li className="rounded-[12px] border border-border bg-surface p-[13px]" key={entry.id}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[10px] text-muted-fg">
                {formatDate(lang, entry.date)}
              </span>
              {entry.version ? (
                <span className="rounded-[4px] border border-border px-[6px] font-mono text-[10px] text-fg">
                  {entry.version}
                </span>
              ) : null}
              <span className="font-mono text-[9.5px] text-muted-fg">
                {channelLabel(entry.channel)}
              </span>
            </div>
            <h2 className="m-0 mt-[6px] font-semibold text-[13.5px] tracking-[-0.01em]">
              {entry.title}
            </h2>
            <p className="m-0 mt-[4px] text-[12px] text-muted-fg leading-[1.55]">{entry.summary}</p>
          </li>
        ))}
      </ol>
    </article>
  )
}
