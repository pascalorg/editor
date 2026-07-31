'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface AdminUser {
  id: string
  email: string
  role: 'user' | 'admin'
  createdAt: string
  sceneCount: number
}

export interface AdminScene {
  id: string
  name: string
  ownerId: string | null
  ownerEmail: string | null
  updatedAt: string
  nodeCount: number
}

export function AdminPanel({
  users,
  scenes,
  currentAdminId,
}: {
  users: AdminUser[]
  scenes: AdminScene[]
  currentAdminId: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function call(url: string, body: unknown, key: string) {
    setBusy(key)
    setError(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string }
        setError(b.error ?? `Request failed (${res.status})`)
        return
      }
      router.refresh()
    } catch {
      setError('Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  const unownedCount = scenes.filter((s) => !s.ownerId).length

  return (
    <div className="flex flex-col gap-10">
      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-600 text-sm">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-3 font-bold text-2xl">Users ({users.length})</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Scenes</th>
                <th className="px-4 py-2 font-medium">Joined</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-border border-t">
                  <td className="px-4 py-2">{u.email}</td>
                  <td className="px-4 py-2">
                    <span className={u.role === 'admin' ? 'font-semibold' : ''}>{u.role}</span>
                  </td>
                  <td className="px-4 py-2">{u.sceneCount}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {u.id === currentAdminId ? (
                      <span className="text-muted-foreground text-xs">you</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          call(
                            `/api/admin/users/${u.id}/role`,
                            { role: u.role === 'admin' ? 'user' : 'admin' },
                            `role-${u.id}`,
                          )
                        }
                        className="rounded-md border border-border px-2 py-1 text-xs"
                      >
                        {u.role === 'admin' ? 'Make user' : 'Make admin'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-bold text-2xl">Scenes ({scenes.length})</h2>
          {unownedCount > 0 && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                call('/api/admin/scenes/adopt-unowned', { ownerId: currentAdminId }, 'adopt')
              }
              className="rounded-md border border-border px-3 py-1.5 text-xs"
            >
              {busy === 'adopt' ? 'Adopting…' : `Adopt ${unownedCount} unowned scene(s) to me`}
            </button>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Scene</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Nodes</th>
                <th className="px-4 py-2 font-medium">Updated</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {scenes.map((s) => (
                <tr key={s.id} className="border-border border-t">
                  <td className="px-4 py-2">
                    <a href={`/scene/${s.id}`} className="hover:underline">
                      {s.name}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {s.ownerEmail ?? (s.ownerId ? s.ownerId : <em>unowned</em>)}
                  </td>
                  <td className="px-4 py-2">{s.nodeCount}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(s.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <select
                      disabled={busy !== null}
                      defaultValue={s.ownerId ?? ''}
                      onChange={(e) =>
                        call(
                          `/api/admin/scenes/${s.id}/owner`,
                          { ownerId: e.target.value === '' ? null : e.target.value },
                          `owner-${s.id}`,
                        )
                      }
                      className="rounded-md border border-border bg-transparent px-2 py-1 text-xs"
                    >
                      <option value="">unowned</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.email}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
