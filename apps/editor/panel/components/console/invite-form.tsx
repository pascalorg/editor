'use client';

import { useState } from 'react';
import { useApp } from '@panel/components/app-providers';
import { Caps } from '@panel/components/ui/caps';
import { SegBar, SegButton } from '@panel/components/ui/controls';
import { call } from '@panel/lib/client-api';
import type { CreateUserResponse } from '@panel/lib/api-contract';
import { resolveApiMessage } from '@panel/lib/i18n';
import type { UserV3 } from '@panel/lib/types';
import { cn } from '@panel/lib/cn';

const DOMAIN = '@netlog.com.tr';

/**
 * Inline "add user" row. Notably it does NOT take a password: the account is
 * created as `invited` and sets its own via the emailed link. That removes the
 * old panel's readable-password column at the source rather than masking it.
 */
export function InviteForm({
  roles,
  sites,
  onCancel,
  onCreated,
  onError,
}: {
  roles: string[];
  sites: string[];
  onCancel: () => void;
  onCreated: (user: UserV3) => void;
  onError: (message: string) => void;
}) {
  const { t } = useApp();

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState(roles.includes('Editor') ? 'Editor' : (roles[0] ?? 'Viewer'));
  const [org, setOrg] = useState<'internal' | 'external'>('internal');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!fullName.trim() || !username.trim()) {
      onError(t.errFields);
      return;
    }

    setBusy(true);
    const res = await call<CreateUserResponse>('/api/users', {
      body: {
        fullName: fullName.trim(),
        username: username.trim().toLowerCase().replace(/@.*$/, ''),
        role,
        org,
        siteNames: selected,
      },
    });
    setBusy(false);

    if (!res.ok) {
      onError(resolveApiMessage(t, res.messageKey));
      return;
    }
    onCreated(res.data.user);
  };

  return (
    <div
      className="flex flex-wrap items-end gap-[10px] rounded-[12px] border border-input bg-surface p-[13px]"
      style={{ animation: 'dtDrop 0.16s ease' }}
    >
      <div className="flex min-w-[132px] flex-1 flex-col gap-[5px]">
        <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">{t.inviteFullName}</Caps>
        <input
          type="text"
          placeholder={t.egName}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="h-8 w-full min-w-0 rounded-[8px] border border-input bg-field px-[10px] text-xs text-fg outline-none focus:border-ring"
        />
      </div>

      <div className="flex min-w-[190px] flex-1 flex-col gap-[5px]">
        <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">{t.inviteEmail}</Caps>
        <div className="flex min-w-0 items-center overflow-hidden rounded-[8px] border border-input bg-field focus-within:border-ring">
          <input
            type="text"
            placeholder="yusuf.aydin"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="h-8 min-w-0 flex-1 bg-transparent px-[10px] text-xs text-fg outline-none"
          />
          <span className="flex h-8 shrink-0 items-center border-l border-input bg-surface px-[10px] font-mono text-[10.5px] text-muted-fg">
            {DOMAIN}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-[5px]">
        <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">{t.inviteRole}</Caps>
        <SegBar>
          {roles.map((name) => (
            <SegButton
              key={name}
              active={role === name}
              onClick={() => setRole(name)}
            >
              {name}
            </SegButton>
          ))}
        </SegBar>
      </div>

      <div className="flex flex-col gap-[5px]">
        <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">{t.inviteOrg}</Caps>
        <SegBar>
          <SegButton active={org === 'internal'} onClick={() => setOrg('internal')}>
            {t.orgInternal}
          </SegButton>
          <SegButton active={org === 'external'} onClick={() => setOrg('external')}>
            {t.orgExternal}
          </SegButton>
        </SegBar>
      </div>

      <div className="flex w-full flex-col gap-[5px]">
        <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">{t.inviteSites}</Caps>
        <div className="flex flex-wrap gap-[6px]">
          {sites.map((site) => {
            const on = selected.includes(site);
            return (
              <button
                key={site}
                type="button"
                onClick={() => setSelected((prev) => (on ? prev.filter((s) => s !== site) : [...prev, site]))}
                className={cn(
                  'flex h-[28px] items-center gap-2 rounded-[7px] border px-[9px] text-[11.5px]',
                  on ? 'border-brand bg-field text-fg' : 'border-border bg-transparent text-muted-fg',
                )}
              >
                <span
                  className={cn(
                    'h-[9px] w-[9px] shrink-0 rounded-[3px] border',
                    on ? 'border-brand bg-brand' : 'border-input',
                  )}
                />
                {site}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-[7px]">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="h-8 rounded-[8px] bg-primary px-[14px] text-xs font-semibold text-primary-fg hover:opacity-92"
        >
          {t.save}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-[8px] border border-border bg-transparent px-3 text-xs text-muted-fg hover:bg-hover hover:text-fg"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}
