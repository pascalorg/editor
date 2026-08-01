import { dictionaryFor } from '@panel/lib/i18n'
import type { Lang } from '@panel/lib/types'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { guidesFor } from '@/lib/guides-content'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Documentation' }

/**
 * The documentation index: a welcome, a short path in, then the whole manual
 * as cards. Text only — a screenshot would have to be recaptured every
 * release, and a stale one teaches the wrong interface.
 */
export default async function GuidesIndex() {
  const jar = await cookies()
  const lang: Lang = jar.get('digitaltwin_lang')?.value === 'tr' ? 'tr' : 'en'
  const t = dictionaryFor(lang)
  const guides = guidesFor(lang)
  const [firstGroup, ...restGroups] = guides.groups

  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 font-semibold text-[30px] leading-[1.15] tracking-[-0.02em]">
          {guides.title}
        </h1>
        {guides.lead.map((paragraph) => (
          <p className="m-0 text-[14.5px] text-muted-fg leading-[1.7]" key={paragraph}>
            {paragraph}
          </p>
        ))}
      </header>

      {firstGroup ? (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 font-semibold text-[17px] tracking-[-0.01em]">{guides.startHere}</h2>
          <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
            {firstGroup.pages.map((page) => (
              <GuideCard
                description={page.description}
                key={page.slug}
                slug={page.slug}
                title={page.title}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-5">
        <h2 className="m-0 font-semibold text-[17px] tracking-[-0.01em]">{guides.explore}</h2>
        {restGroups.map((group) => (
          <div className="flex flex-col gap-[10px]" key={group.title}>
            <h3 className="m-0 font-mono text-[10px] text-muted-fg uppercase tracking-[0.14em]">
              {group.title}
            </h3>
            <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
              {group.pages.map((page) => (
                <GuideCard
                  description={page.description}
                  key={page.slug}
                  slug={page.slug}
                  title={page.title}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <footer className="border-border border-t pt-5">
        <p className="m-0 text-[13px] text-muted-fg leading-[1.65]">
          {t.qlChangelog}:{' '}
          <Link className="text-fg underline underline-offset-[3px]" href="/changelog">
            /changelog
          </Link>
        </p>
      </footer>
    </article>
  )
}

function GuideCard({
  slug,
  title,
  description,
}: {
  slug: string
  title: string
  description: string
}) {
  return (
    <Link
      className="flex flex-col gap-[5px] rounded-[12px] border border-border bg-surface p-[14px] no-underline transition-colors hover:bg-hover"
      href={`/guides/${slug}`}
    >
      <span className="font-semibold text-[13.5px] text-fg tracking-[-0.01em]">{title}</span>
      <span className="text-[12.5px] text-muted-fg leading-[1.55]">{description}</span>
    </Link>
  )
}
