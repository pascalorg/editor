'use client';

import { useState } from 'react';
import { useApp } from '@panel/components/app-providers';
import { Button, SegBar, SegButton } from '@panel/components/ui/controls';
import { Caps } from '@panel/components/ui/caps';
import { Dialog } from '@panel/components/ui/feedback';
import { call } from '@panel/lib/client-api';
import type { ApproveRequestResponse } from '@panel/lib/api-contract';
import { resolveApiMessage } from '@panel/lib/i18n';
import type { AccessRequest } from '@panel/lib/types';
import { cn } from '@panel/lib/cn';

/**
 * "Approve & assign" — approval never silently adds an account. It asks for a
 * role and at least one site first, so nobody lands in the tenant with a role
 * but nothing to open.
 */
export function AssignDialog({
  request,
  roles,
  sites,
  onCancel,
  onDone,
  onError,
}: {
  request: AccessRequest;
  roles: string[];
  sites: string[];
  onCancel: () => void;
  onDone: (email: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useApp();

  const [role, setRole] = useState(
    roles.includes(request.requestedRole) ? request.requestedRole : (roles[0] ?? 'Viewer'),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [org, setOrg] = useState<'internal' | 'external'>('internal');
  const [busy, setBusy] = useState(false);

  // Escape is handled by <Dialog> through the layer stack — see onClose below.

  const confirm = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    const res = await call<ApproveRequestResponse>(`/api/requests/${request.id}/approve`, {
      body: { role, siteNames: selected, org },
    });
    setBusy(false);

    if (!res.ok) {
      onError(resolveApiMessage(t, res.messageKey));
      return;
    }
    onDone(res.data.user.email);
  };

  const ready = selected.length > 0;

  return (
    <Dialog labelledBy="dt-assign-title" width={384} onClose={onCancel}>
      <div className="flex flex-col gap-1">
        <h2 id="dt-assign-title" className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
          {t.asgTitle}
        </h2>
        <span className="truncate font-mono text-[10.5px] text-muted-fg">
          {request.fullName} · {request.email}
        </span>
        <p className="m-0 mt-1 text-[11.5px] leading-[1.5] text-muted-fg text-pretty">{t.asgLead}</p>
      </div>

      <div className="flex flex-col gap-[6px]">
        <Caps className="text-[10px] font-medium tracking-[0.12em] text-muted-fg">{t.asgRole}</Caps>
        <SegBar>
          {roles.map((name) => (
            <SegButton key={name} active={role === name} onClick={() => setRole(name)}>
              {name}
            </SegButton>
          ))}
        </SegBar>
      </div>

      <div className="flex flex-col gap-[6px]">
        <Caps className="text-[10px] font-medium tracking-[0.12em] text-muted-fg">{t.inviteOrg}</Caps>
        <SegBar>
          <SegButton active={org === 'internal'} onClick={() => setOrg('internal')}>
            {t.orgInternal}
          </SegButton>
          <SegButton active={org === 'external'} onClick={() => setOrg('external')}>
            {t.orgExternal}
          </SegButton>
        </SegBar>
      </div>

      <div className="flex flex-col gap-[6px]">
        <Caps className="text-[10px] font-medium tracking-[0.12em] text-muted-fg">{t.asgSites}</Caps>
        <div className="grid grid-cols-2 gap-[6px]">
          {sites.map((site) => {
            const on = selected.includes(site);
            return (
              <button
                key={site}
                type="button"
                onClick={() => setSelected((prev) => (on ? prev.filter((s) => s !== site) : [...prev, site]))}
                className={cn(
                  'flex h-[30px] min-w-0 items-center gap-2 rounded-[7px] border px-[9px] text-[11.5px]',
                  on ? 'border-brand bg-field text-fg' : 'border-border bg-transparent text-muted-fg',
                )}
              >
                <span
                  className={cn(
                    'h-[10px] w-[10px] shrink-0 rounded-[3px] border',
                    on ? 'border-brand bg-brand' : 'border-input',
                  )}
                />
                <span className="truncate">{site}</span>
              </button>
            );
          })}
        </div>
        {!ready ? <span className="text-[11px] text-muted-fg">{t.asgNeedSite}</span> : null}
      </div>

      <div className="flex flex-col gap-[9px]">
        <div
          className="flex flex-col"
          style={{ opacity: ready ? 1 : 0.45, pointerEvents: ready ? 'auto' : 'none' }}
        >
          <Button onClick={() => void confirm()} disabled={busy}>
            {t.asgConfirm}
          </Button>
        </div>
        <Button variant="secondary" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </Dialog>
  );
}
