'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

export interface DocsNavGroup {
  title: string
  pages: { slug: string; title: string }[]
}

/**
 * The documentation frame: the page tree on the left, the article in the
 * middle, and what is on this page down the right. The tree is a client
 * component only so it can mark where the reader is — everything it renders
 * comes from the server.
 */
export function DocsShell({
  groups,
  onThisPage,
  onThisPageLabel,
  children,
}: {
  groups: DocsNavGroup[]
  onThisPage?: { id: string; title: string }[]
  onThisPageLabel: string
  children: ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="mx-auto flex max-w-6xl gap-8 px-6 py-9">
      <nav className="hidden w-[212px] shrink-0 lg:block">
        <div className="sticky top-[74px] flex flex-col gap-5">
          {groups.map((group) => (
            <div className="flex flex-col gap-[3px]" key={group.title}>
              <span className="px-[9px] pb-[3px] font-semibold text-[12.5px] text-fg">
                {group.title}
              </span>
              {group.pages.map((page) => {
                const href = `/guides/${page.slug}`
                const active = pathname === href
                return (
                  <Link
                    className={`rounded-[7px] px-[9px] py-[5px] text-[12.5px] no-underline transition-colors ${
                      active
                        ? 'bg-hover font-medium text-fg'
                        : 'text-muted-fg hover:bg-hover/60 hover:text-fg'
                    }`}
                    href={href}
                    key={page.slug}
                  >
                    {page.title}
                  </Link>
                )
              })}
            </div>
          ))}
        </div>
      </nav>

      <main className="min-w-0 flex-1">{children}</main>

      {onThisPage && onThisPage.length > 0 ? (
        <aside className="hidden w-[188px] shrink-0 xl:block">
          <div className="sticky top-[74px] flex flex-col gap-[7px]">
            <span className="font-mono text-[10px] text-muted-fg uppercase tracking-[0.14em]">
              {onThisPageLabel}
            </span>
            {onThisPage.map((item) => (
              <a
                className="text-[12.5px] text-muted-fg no-underline leading-[1.5] hover:text-fg"
                href={`#${item.id}`}
                key={item.id}
              >
                {item.title}
              </a>
            ))}
          </div>
        </aside>
      ) : null}
    </div>
  )
}
