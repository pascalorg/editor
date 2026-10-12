export const dynamic = 'force-dynamic'

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
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
        <p className="font-mono text-muted-foreground text-xs uppercase tracking-wide">Pascal</p>
        <h1 className="mt-2 font-semibold text-lg">
          This editor is reachable but not protected yet
        </h1>
        <p className="mt-2 text-muted-foreground text-sm">
          Set an admin password in the environment and restart. Until then, nothing is served from
          this address.
        </p>
        <dl className="mt-5 flex flex-col gap-3">
          {VARIABLES.map(([name, description]) => (
            <div key={name}>
              <dt className="font-mono text-sm">{name}</dt>
              <dd className="text-muted-foreground text-xs">{description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
