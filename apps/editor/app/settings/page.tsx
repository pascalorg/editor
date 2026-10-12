import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { AppHeader, AppShell, SECONDARY_PILL } from '@/components/app-shell'
import { resolvePublicUrl } from '@/lib/public-url'
import { resolveAuthMode } from '@/lib/self-host-auth'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Settings · Pascal' }

/** Server components see headers, not a Request; the auth helpers want the latter. */
async function currentRequest(): Promise<Request> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return new Request(`${proto}://${host}/settings`, { headers: h })
}

export default async function SettingsPage() {
  const request = await currentRequest()
  const publicUrl = resolvePublicUrl(request)
  const authMode = resolveAuthMode(request)
  const agentTokenConfigured = Boolean(process.env.PASCAL_SCENE_API_TOKEN)

  return (
    <AppShell>
      <AppHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <Link
          className="-ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground"
          href="/"
        >
          <ArrowLeft className="h-4 w-4" />
          All projects
        </Link>
        <h1 className="mt-4 mb-8 font-semibold text-lg">Settings</h1>

        <div className="flex flex-col gap-6">
          <Section title="Instance">
            <Row label="Public URL">
              <code className="font-mono">{publicUrl}</code>
            </Row>
            <Row label="Version">{process.env.PASCAL_RUNTIME_VERSION || 'development'}</Row>
            <Row label="Data directory">
              <code className="font-mono">{process.env.PASCAL_DATA_DIR || '~/.pascal/data'}</code>
            </Row>
          </Section>

          <Section title="Connect an agent">
            <Row label="Scene API">
              <code className="font-mono">{publicUrl}/api/scenes</code>
            </Row>
            <Row label="Agent token">{agentTokenConfigured ? 'Configured' : 'Not configured'}</Row>
            <p className="px-4 py-3 text-muted-foreground text-xs">
              {agentTokenConfigured
                ? 'Agents and scripts send the PASCAL_SCENE_API_TOKEN value in an Authorization: Bearer header.'
                : 'Set PASCAL_SCENE_API_TOKEN on this instance, then send it in an Authorization: Bearer header from agents and scripts.'}
            </p>
          </Section>

          {authMode === 'password' && (
            <Section title="Account">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <p className="text-muted-foreground text-sm">Signed in as the instance admin.</p>
                <form action="/api/auth/logout" method="post">
                  <button className={SECONDARY_PILL} type="submit">
                    Sign out
                  </button>
                </form>
              </div>
            </Section>
          )}

          <Section title="About">
            <ExternalRow href="https://github.com/pascalorg/editor" label="Source code" />
            <ExternalRow href="https://editor.pascal.app/docs" label="Documentation" />
          </Section>
        </div>
      </main>
    </AppShell>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-medium text-muted-foreground text-xs">{title}</h2>
      <div className="divide-y divide-border/50 rounded-xl border border-border/50 bg-background">
        {children}
      </div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  )
}

function ExternalRow({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="flex items-center justify-between gap-4 px-4 py-3 text-sm transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <span>{label}</span>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {href.replace(/^https:\/\//, '')}
        <ExternalLink className="h-3.5 w-3.5" />
      </span>
    </a>
  )
}
