'use client'

import { useApp } from '@panel/components/app-providers'
import { useEffect, useState } from 'react'

/**
 * The documentation, inside the console.
 *
 * The same pages the public site serves — fetched rather than duplicated, so
 * there is one manual and it cannot drift into two. Signed-in people should
 * not have to leave the console to look something up.
 */

interface GuideBlock {
  heading: string
  body?: string[]
  points?: string[]
  table?: { columns: [string, string]; rows: [string, string][] }
}

interface GuidePage {
  slug: string
  title: string
  description: string
  blocks: GuideBlock[]
}

interface GuideGroup {
  title: string
  pages: GuidePage[]
}

export function GuidesTab() {
  const { t, lang } = useApp()
  const [groups, setGroups] = useState<GuideGroup[]>([])
  const [slug, setSlug] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/guides?lang=${lang}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { groups: [] }))
      .then((body: { groups?: GuideGroup[] }) => {
        if (cancelled) return
        setGroups(body.groups ?? [])
        setSlug((current) => current ?? body.groups?.[0]?.pages?.[0]?.slug ?? null)
      })
      .catch(() => {
        /* the empty state covers it */
      })
    return () => {
      cancelled = true
    }
  }, [lang])

  const page = groups.flatMap((group) => group.pages).find((p) => p.slug === slug)

  return (
    <section className="flex min-w-0 gap-6" style={{ animation: 'dtFade 0.2s ease' }}>
      <nav className="hidden w-[196px] shrink-0 flex-col gap-4 md:flex">
        {groups.map((group) => (
          <div className="flex flex-col gap-[3px]" key={group.title}>
            <span className="px-[9px] pb-[3px] font-semibold text-[12px] text-fg">
              {group.title}
            </span>
            {group.pages.map((item) => (
              <button
                className={`cursor-pointer rounded-[7px] px-[9px] py-[5px] text-left text-[12.5px] transition-colors ${
                  item.slug === slug
                    ? 'bg-hover font-medium text-fg'
                    : 'text-muted-fg hover:bg-hover/60 hover:text-fg'
                }`}
                key={item.slug}
                onClick={() => setSlug(item.slug)}
                type="button"
              >
                {item.title}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <article className="flex min-w-0 max-w-[680px] flex-1 flex-col gap-7">
        {page ? (
          <>
            <header className="flex flex-col gap-[6px]">
              <h2 className="m-0 font-semibold text-[19px] tracking-[-0.015em]">{page.title}</h2>
              <p className="m-0 text-[13px] text-muted-fg leading-[1.6]">{page.description}</p>
            </header>

            {page.blocks.map((block) => (
              <div className="flex flex-col gap-[9px]" key={block.heading}>
                <h3 className="m-0 font-semibold text-[14.5px] tracking-[-0.01em]">
                  {block.heading}
                </h3>

                {block.body?.map((paragraph) => (
                  <p className="m-0 text-[13px] text-fg leading-[1.7]" key={paragraph}>
                    {paragraph}
                  </p>
                ))}

                {block.points ? (
                  <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
                    {block.points.map((point) => (
                      <li className="flex gap-[9px] text-[13px] text-fg leading-[1.65]" key={point}>
                        <span
                          aria-hidden
                          className="mt-[8px] h-[4px] w-[4px] shrink-0 rounded-full bg-brand"
                        />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {block.table ? (
                  <div className="overflow-x-auto rounded-[12px] border border-border bg-surface">
                    <table className="w-full border-collapse text-[12.5px]">
                      <thead>
                        <tr className="border-border border-b text-left font-mono text-[9.5px] text-muted-fg uppercase tracking-[0.12em]">
                          <th className="px-[13px] py-[9px] font-medium">
                            {block.table.columns[0]}
                          </th>
                          <th className="px-[13px] py-[9px] font-medium">
                            {block.table.columns[1]}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {block.table.rows.map(([key, value]) => (
                          <tr className="border-border-soft border-t" key={key}>
                            <td className="px-[13px] py-[9px] align-top">
                              <span className="rounded-[5px] border border-border bg-field px-[7px] py-[2px] font-mono text-[11.5px] text-fg">
                                {key}
                              </span>
                            </td>
                            <td className="px-[13px] py-[9px] text-muted-fg">{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ))}
          </>
        ) : (
          <p className="m-0 text-[13px] text-muted-fg">{t.scEmpty}</p>
        )}
      </article>
    </section>
  )
}
