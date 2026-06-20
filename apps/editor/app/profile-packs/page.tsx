'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

type InstalledPack = {
  id: string
  name: string
  industry: string
  version: string
  profileCount: number
  layoutCount?: number
  partPresetCount?: number
  qualityRuleCount?: number
  enabled: boolean
  path: string
  description?: string
  dependsOn?: PackDependency[]
  dependedOnBy?: Array<{ id: string; version: string; path: string }>
}

type CloudPack = {
  id: string
  name: string
  industry: string
  version: string
  profileCount: number
  layoutCount?: number
  partPresetCount?: number
  qualityRuleCount?: number
  fileName: string
  installed: boolean
  enabled: boolean
  description?: string
  dependsOn?: PackDependency[]
  auditScore: number
  publishStatus: 'publishable' | 'needs_review' | 'blocked'
  packType: 'basic' | 'extension'
  releaseChannel: 'stable' | 'preview'
  dependencyStatus: 'none' | 'satisfied' | 'missing'
  governanceIssues: string[]
  governanceWarnings: string[]
}

type PackDependency = {
  id: string
  version?: string
}

type ProfileDebug = {
  id: string
  name: string
  source: string
  sourcePack?: { id: string; version: string }
  family: string
  layoutFamily?: string
  primarySemanticRole: string
  partCount: number
  overrides: Array<{
    id: string
    name: string
    source: string
    sourcePack?: { id: string; version: string }
  }>
}

type PackData = {
  packs?: InstalledPack[]
  profileDebug?: ProfileDebug[]
  conflicts?: Array<{
    id: string
    winner: { source: string; sourcePack?: { id: string; version: string } }
    overridden: ProfileDebug['overrides']
  }>
  warnings?: string[]
  summary?: {
    enabledCount?: number
    profileCount?: number
    loadedProfileCount?: number
    conflictCount?: number
  }
}

type CloudCatalog = {
  summary?: {
    packCount?: number
    industryCount?: number
    profileCount?: number
    installedCount?: number
    publishableCount?: number
    needsReviewCount?: number
    blockedCount?: number
  }
  industries?: Array<{
    id: string
    packCount: number
    profileCount: number
    publishableCount: number
    blockedCount: number
  }>
  issues?: string[]
  warnings?: string[]
}

async function jsonOrThrow(response: Response) {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : 'Request failed',
    )
  }
  return data
}

function packLabel(pack?: { id: string; version: string }) {
  return pack ? `${pack.id}@${pack.version}` : 'no pack'
}

export default function ProfilePacksPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [installedPacks, setInstalledPacks] = useState<InstalledPack[]>([])
  const [cloudPacks, setCloudPacks] = useState<CloudPack[]>([])
  const [cloudCatalog, setCloudCatalog] = useState<CloudCatalog | null>(null)
  const [profileDebug, setProfileDebug] = useState<ProfileDebug[]>([])
  const [conflicts, setConflicts] = useState<PackData['conflicts']>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [installedResponse, cloudResponse] = await Promise.all([
      fetch('/api/profile-packs', { cache: 'no-store' }),
      fetch('/api/profile-packs/cloud', { cache: 'no-store' }),
    ])
    const installedData = (await jsonOrThrow(installedResponse)) as PackData
    const cloudData = (await jsonOrThrow(cloudResponse)) as {
      packs?: CloudPack[]
      catalog?: CloudCatalog
    }
    setInstalledPacks(Array.isArray(installedData.packs) ? installedData.packs : [])
    setProfileDebug(Array.isArray(installedData.profileDebug) ? installedData.profileDebug : [])
    setConflicts(Array.isArray(installedData.conflicts) ? installedData.conflicts : [])
    setWarnings(Array.isArray(installedData.warnings) ? installedData.warnings : [])
    setCloudPacks(Array.isArray(cloudData.packs) ? cloudData.packs : [])
    setCloudCatalog(cloudData.catalog ?? null)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    refresh()
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function runAction(key: string, action: () => Promise<string>) {
    setBusyKey(key)
    setMessage(null)
    try {
      const nextMessage = await action()
      await refresh()
      setMessage(nextMessage)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(null)
    }
  }

  async function importLocalPack(file: File | undefined) {
    if (!file) return
    await runAction(`import:${file.name}`, async () => {
      const form = new FormData()
      form.set('file', file)
      const data = (await jsonOrThrow(
        await fetch('/api/profile-packs', { method: 'POST', body: form }),
      )) as { pack?: InstalledPack }
      return data.pack
        ? `Imported and enabled ${data.pack.name} (${data.pack.profileCount} profiles).`
        : 'Profile pack imported.'
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const enabledPacks = installedPacks.filter((pack) => pack.enabled)
  const enabledProfileCount = enabledPacks.reduce((sum, pack) => sum + pack.profileCount, 0)

  return (
    <main className="min-h-screen bg-background px-6 py-6 text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3 border-border border-b pb-4">
          <div>
            <div className="font-mono text-muted-foreground text-xs uppercase">
              Pascal Profile Packs
            </div>
            <h1 className="mt-1 font-semibold text-2xl">Profile Pack Manager</h1>
            <p className="mt-1 text-muted-foreground text-sm">
              Install industry packs, inspect active device profiles, and review override conflicts.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              className="rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
              href="/"
            >
              Back
            </Link>
            <input
              accept=".zip,application/zip,application/x-zip-compressed"
              className="hidden"
              onChange={(event) => void importLocalPack(event.currentTarget.files?.[0])}
              ref={fileInputRef}
              type="file"
            />
            <button
              className="rounded-md border border-border bg-primary px-3 py-2 text-primary-foreground text-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busyKey != null}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              Import zip
            </button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-4">
          <Stat label="Installed packs" value={installedPacks.length} />
          <Stat label="Enabled packs" value={enabledPacks.length} />
          <Stat label="Enabled profiles" value={enabledProfileCount} />
          <Stat label="Override conflicts" value={conflicts?.length ?? 0} />
        </section>

        <section className="grid gap-3 sm:grid-cols-4">
          <Stat label="Cloud industries" value={cloudCatalog?.summary?.industryCount ?? 0} />
          <Stat label="Cloud profiles" value={cloudCatalog?.summary?.profileCount ?? 0} />
          <Stat label="Publishable packs" value={cloudCatalog?.summary?.publishableCount ?? 0} />
          <Stat label="Blocked packs" value={cloudCatalog?.summary?.blockedCount ?? 0} />
        </section>

        {message ? (
          <div className="rounded-md border border-border bg-accent/40 px-3 py-2 text-sm">
            {message}
          </div>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium text-lg">Installed Packs</h2>
              <button
                className="rounded-md border border-border px-2.5 py-1.5 text-muted-foreground text-xs hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading || busyKey != null}
                onClick={() =>
                  void runAction('refresh', async () => 'Profile pack status refreshed.')
                }
                type="button"
              >
                Refresh
              </button>
            </div>
            {loading ? (
              <EmptyState text="Loading profile packs..." />
            ) : installedPacks.length === 0 ? (
              <EmptyState text="No profile packs installed. Download a simulated cloud pack or import a local zip." />
            ) : (
              <div className="grid gap-3">
                {installedPacks.map((pack) => (
                  <PackCard
                    busy={busyKey != null}
                    key={pack.path}
                    pack={pack}
                    onDelete={() =>
                      runAction(`delete:${pack.path}`, async () => {
                        await jsonOrThrow(
                          await fetch(`/api/profile-packs/${encodeURIComponent(pack.path)}`, {
                            method: 'DELETE',
                          }),
                        )
                        return `Deleted ${pack.name}.`
                      })
                    }
                    onToggle={() =>
                      runAction(`toggle:${pack.path}`, async () => {
                        await jsonOrThrow(
                          await fetch(`/api/profile-packs/${encodeURIComponent(pack.path)}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ enabled: !pack.enabled }),
                          }),
                        )
                        return pack.enabled ? `Disabled ${pack.name}.` : `Enabled ${pack.name}.`
                      })
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="font-medium text-lg">Simulated Cloud</h2>
            {cloudCatalog?.industries?.length ? (
              <div className="grid gap-2">
                {cloudCatalog.industries.map((industry) => (
                  <div
                    className="rounded-md border border-border bg-card px-3 py-2 text-sm"
                    key={industry.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{industry.id}</span>
                      <span className="text-muted-foreground text-xs">
                        {industry.packCount} packs / {industry.profileCount} profiles
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground text-xs">
                      {industry.publishableCount} publishable
                      {industry.blockedCount ? ` / ${industry.blockedCount} blocked` : ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {cloudPacks.length === 0 ? (
              <EmptyState text="No local simulated cloud zip files found." />
            ) : (
              <div className="grid gap-3">
                {cloudPacks.map((pack) => (
                  <article
                    className="rounded-lg border border-border bg-card p-4"
                    key={pack.fileName}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium">{pack.name}</h3>
                          <CloudGovernanceBadge status={pack.publishStatus} />
                        </div>
                        <p className="mt-2 text-muted-foreground text-sm">
                          {pack.description ?? 'No description.'}
                        </p>
                        <PackMeta pack={pack} />
                        <CloudGovernanceMeta pack={pack} />
                      </div>
                      <button
                        className="shrink-0 rounded-md border border-border bg-primary px-2.5 py-1.5 text-primary-foreground text-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={busyKey != null || pack.publishStatus === 'blocked'}
                        onClick={() =>
                          void runAction(`cloud:${pack.id}@${pack.version}`, async () => {
                            const data = (await jsonOrThrow(
                              await fetch('/api/profile-packs/cloud', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: pack.id, version: pack.version }),
                              }),
                            )) as {
                              pack?: InstalledPack
                              installedDependencies?: InstalledPack[]
                            }
                            const dependencyNames =
                              data.installedDependencies
                                ?.map((dependency) => dependency.name)
                                .filter(Boolean) ?? []
                            return data.pack
                              ? `Downloaded and enabled ${data.pack.name}${
                                  dependencyNames.length
                                    ? ` with ${dependencyNames.join(', ')}.`
                                    : '.'
                                }`
                              : `Downloaded ${pack.name}.`
                          })
                        }
                        type="button"
                      >
                        {pack.installed ? 'Reinstall' : 'Download'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3">
            <h2 className="font-medium text-lg">Override Conflicts</h2>
            {conflicts?.length ? (
              <div className="grid gap-3">
                {conflicts.map((conflict) => (
                  <article
                    className="rounded-lg border border-border bg-card p-4"
                    key={conflict.id}
                  >
                    <div className="font-medium">{conflict.id}</div>
                    <div className="mt-1 text-muted-foreground text-sm">
                      Winner: {conflict.winner.source} / {packLabel(conflict.winner.sourcePack)}
                    </div>
                    <div className="mt-2 space-y-1 text-muted-foreground text-xs">
                      {conflict.overridden.map((entry) => (
                        <div key={`${entry.source}:${entry.id}:${packLabel(entry.sourcePack)}`}>
                          Overrides {entry.source} / {packLabel(entry.sourcePack)}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState text="No active profile overrides." />
            )}
          </div>

          <div className="space-y-3">
            <h2 className="font-medium text-lg">Profile Debug</h2>
            <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-card text-muted-foreground text-xs">
                  <tr>
                    <th className="px-3 py-2">Profile</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Family</th>
                    <th className="px-3 py-2">Parts</th>
                  </tr>
                </thead>
                <tbody>
                  {profileDebug.map((profile) => (
                    <tr className="border-border border-t" key={`${profile.source}:${profile.id}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{profile.name}</div>
                        <div className="font-mono text-muted-foreground text-xs">{profile.id}</div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {profile.source}
                        {profile.sourcePack ? (
                          <div className="font-mono text-xs">{packLabel(profile.sourcePack)}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {profile.family}
                        <div className="font-mono text-xs">
                          {profile.layoutFamily ?? 'no layout'}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {profile.partCount}
                        <div className="font-mono text-xs">{profile.primarySemanticRole}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {warnings.length ? (
          <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <h2 className="font-medium text-amber-700 text-sm dark:text-amber-300">
              Loader Warnings
            </h2>
            <ul className="mt-2 space-y-1 text-muted-foreground text-xs">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {cloudCatalog?.issues?.length || cloudCatalog?.warnings?.length ? (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-medium text-sm">Cloud Governance Notes</h2>
            <ul className="mt-2 space-y-1 text-muted-foreground text-xs">
              {cloudCatalog.issues?.map((issue) => (
                <li className="text-destructive" key={issue}>
                  {issue}
                </li>
              ))}
              {cloudCatalog.warnings?.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 font-semibold text-2xl">{value}</div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-border p-6 text-center text-muted-foreground text-sm">
      {text}
    </div>
  )
}

function PackMeta({ pack }: { pack: CloudPack | InstalledPack }) {
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
        <span className="rounded border border-border px-1.5 py-0.5">{pack.industry}</span>
        <span className="rounded border border-border px-1.5 py-0.5">v{pack.version}</span>
        <span className="rounded border border-border px-1.5 py-0.5">
          {pack.profileCount} profiles
        </span>
        {'packType' in pack ? (
          <span className="rounded border border-border px-1.5 py-0.5">{pack.packType}</span>
        ) : null}
        {'releaseChannel' in pack ? (
          <span className="rounded border border-border px-1.5 py-0.5">{pack.releaseChannel}</span>
        ) : null}
        {'fileName' in pack ? (
          <span className="rounded border border-border px-1.5 py-0.5">{pack.fileName}</span>
        ) : null}
      </div>
      {pack.dependsOn?.length ? (
        <div className="mt-2 text-muted-foreground text-xs">
          Auto-installs:{' '}
          {pack.dependsOn
            .map((dependency) =>
              dependency.version ? `${dependency.id} ${dependency.version}` : dependency.id,
            )
            .join(', ')}
        </div>
      ) : null}
    </>
  )
}

function CloudGovernanceBadge({ status }: { status: CloudPack['publishStatus'] }) {
  const className =
    status === 'publishable'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
      : status === 'blocked'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] ${className}`}>{status}</span>
}

function CloudGovernanceMeta({ pack }: { pack: CloudPack }) {
  const score = Math.round(pack.auditScore * 100)
  return (
    <div className="mt-2 space-y-1 text-muted-foreground text-xs">
      <div>
        QA score: {score} / Dependency: {pack.dependencyStatus}
      </div>
      {pack.governanceIssues.length ? (
        <ul className="space-y-1 text-destructive">
          {pack.governanceIssues.slice(0, 3).map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {!pack.governanceIssues.length && pack.governanceWarnings.length ? (
        <div>{pack.governanceWarnings.length} governance warnings</div>
      ) : null}
    </div>
  )
}

function PackCard({
  busy,
  pack,
  onDelete,
  onToggle,
}: {
  busy: boolean
  pack: InstalledPack
  onDelete: () => Promise<void>
  onToggle: () => Promise<void>
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{pack.name}</h3>
            <span
              className={
                pack.enabled
                  ? 'rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-300'
                  : 'rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground'
              }
            >
              {pack.enabled ? 'enabled' : 'disabled'}
            </span>
          </div>
          <p className="mt-2 text-muted-foreground text-sm">
            {pack.description ?? 'No description.'}
          </p>
          <PackMeta pack={pack} />
          {pack.dependedOnBy?.length ? (
            <div className="mt-2 text-muted-foreground text-xs">
              Required by: {pack.dependedOnBy.map((dependent) => dependent.id).join(', ')}
            </div>
          ) : null}
          <div className="mt-2 font-mono text-[11px] text-muted-foreground">{pack.path}</div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            className="rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => void onToggle()}
            type="button"
          >
            {pack.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            className="rounded-md border border-destructive/40 px-2.5 py-1.5 text-destructive text-sm hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => void onDelete()}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  )
}
