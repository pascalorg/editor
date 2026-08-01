import type { Lang } from '@panel/lib/types'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { DocsShell } from '@/components/public/docs-shell'
import { guidesFor } from '@/lib/guides-content'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Documentation' }

/** The documentation home: a welcome, a way in, then the manual as cards. */
export default async function GuidesIndex() {
  const jar = await cookies()
  const lang: Lang = jar.get('digitaltwin_lang')?.value === 'tr' ? 'tr' : 'en'
  const guides = guidesFor(lang)
  const [firstGroup, ...restGroups] = guides.groups

  const nav = guides.groups.map((group) => ({
    title: group.title,
    pages: group.pages.map((page) => ({ slug: page.slug, title: page.title })),
  }))

  return (
    <DocsShell
      groups={nav}
      onThisPage={[
        { id: 'start-here', title: guides.startHere },
        { id: 'explore', title: guides.explore },
      ]}
      onThisPageLabel={lang === 'tr' ? 'Bu sayfada' : 'On this page'}
    >
      <article className="flex max-w-[720px] flex-col gap-10">
        <header className="flex flex-col gap-3">
          <span className="font-mono text-[10px] text-muted-fg uppercase tracking-[0.14em]">
            {guides.groups[0]?.title}
          </span>
          <h1 className="m-0 font-bold text-[36px] leading-[1.1] tracking-[-0.025em]">
            {guides.title}
          </h1>
          {guides.lead.map((paragraph) => (
            <p className="m-0 text-[15px] text-muted-fg leading-[1.7]" key={paragraph}>
              {paragraph}
            </p>
          ))}
        </header>

        {firstGroup ? (
          <section className="flex flex-col gap-3" id="start-here">
            <h2 className="m-0 font-semibold text-[19px] tracking-[-0.015em]">
              {guides.startHere}
            </h2>
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

        <section className="flex flex-col gap-6" id="explore">
          <h2 className="m-0 font-semibold text-[19px] tracking-[-0.015em]">{guides.explore}</h2>
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
      </article>
    </DocsShell>
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
      className="flex flex-col gap-[5px] rounded-[12px] border border-border bg-surface p-[14px] no-underline transition-colors hover:border-border/80 hover:bg-hover"
      href={`/guides/${slug}`}
    >
      <span className="font-semibold text-[13.5px] text-fg tracking-[-0.01em]">{title}</span>
      <span className="text-[12.5px] text-muted-fg leading-[1.55]">{description}</span>
    </Link>
  )
}
