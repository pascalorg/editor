import type { Metadata } from 'next'
import { AppCard } from '@/components/app-shell'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Set up · Pascal' }

const VARIABLES = [
  ['PASCAL_ADMIN_PASSWORD', 'The password that unlocks this editor. Required on a network host.'],
  [
    'PASCAL_PUBLIC_URL',
    'The address people use to reach it, for example https://pascal.example.com.',
  ],
  [
    'PASCAL_SCENE_API_TOKEN',
    'Optional. A bearer token for agents and scripts calling the scene API.',
  ],
  [
    'PASCAL_AUTH=proxy',
    'Alternative to a password when a reverse proxy already authenticates every request.',
  ],
] as const

export default function SetupPage() {
  return (
    <AppCard className="max-w-lg">
      <h1 className="mt-6 font-semibold text-lg">This editor is reachable but not protected yet</h1>
      <p className="mt-2 text-muted-foreground text-sm">
        Set an admin password in the environment and restart. Until then, nothing is served from
        this address.
      </p>
      <dl className="mt-5 flex flex-col divide-y divide-border/50 rounded-xl border border-border/50">
        {VARIABLES.map(([name, description]) => (
          <div className="px-4 py-3" key={name}>
            <dt className="font-mono text-sm">{name}</dt>
            <dd className="mt-0.5 text-muted-foreground text-xs">{description}</dd>
          </div>
        ))}
      </dl>
    </AppCard>
  )
}
