'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@panel/components/app-providers';
import { AuthFooter, AuthShell } from '@panel/components/auth/auth-shell';
import { AuthCard, Button, Field, FieldLabel, SegBar, SegButton } from '@panel/components/ui/controls';
import { ErrorBox, ScreenTitle, SuccessMark } from '@panel/components/ui/feedback';
import { call } from '@panel/lib/client-api';
import type { AccessRequestResponse } from '@panel/lib/api-contract';
import { resolveApiMessage } from '@panel/lib/i18n';
import { useBreakpoint } from '@panel/lib/hooks/use-breakpoint';
import { Caps } from '@panel/components/ui/caps';

const DOMAIN = '@netlog.com.tr';
const DEPARTMENTS = ['Warehouse', 'Operations', 'Engineering', 'IT'];
const ROLES = ['Editor', 'Viewer'];

export function RequestAccessScreen() {
  const { t } = useApp();
  const router = useRouter();
  const { touch } = useBreakpoint();

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [role, setRole] = useState(ROLES[0]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = useCallback(async () => {
    if (!fullName.trim() || !username.trim()) {
      setError(t.errFields);
      return;
    }

    setBusy(true);
    setError(null);
    const res = await call<AccessRequestResponse>('/api/requests', {
      body: {
        fullName: fullName.trim(),
        // Local part only. The domain is a fixed adornment here and is applied
        // server-side, so a foreign address cannot be typed past the form.
        username: username.trim().toLowerCase().replace(/@.*$/, ''),
        department,
        requestedRole: role,
        note: note.trim() || undefined,
      },
    });
    setBusy(false);

    if (!res.ok) {
      setError(resolveApiMessage(t, res.messageKey));
      return;
    }
    setSent(true);
  }, [fullName, username, department, role, note, t]);

  return (
    <AuthShell label="Account request">
      <div className="w-full" style={{ maxWidth: 420 }}>
        <AuthCard width={420}>
          {sent ? (
            <div className="flex flex-col gap-5">
              <SuccessMark />
              <div className="flex flex-col gap-[6px]">
                <h1 className="m-0 text-[18px] font-semibold tracking-[-0.01em]">{t.reqSentTitle}</h1>
                <p className="m-0 text-[12.5px] leading-[1.55] text-muted-fg text-pretty">{t.reqSentLead}</p>
                <span className="font-mono text-[11px] text-fg">
                  {username.trim().toLowerCase()}
                  {DOMAIN}
                </span>
              </div>
              <Button variant="secondary" onClick={() => router.push('/signin')}>
                {t.backToSignIn}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-[18px]">
              <div className="flex flex-col gap-1">
                <ScreenTitle title={t.reqTitle} lead={t.reqLead} />
              </div>

              {error ? <ErrorBox shield={false}>{error}</ErrorBox> : null}

              <div className="flex flex-col gap-[6px]">
                <FieldLabel htmlFor="dt-req-name">{t.fullName}</FieldLabel>
                <Field
                  id="dt-req-name"
                  type="text"
                  placeholder={t.egName}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-[6px]">
                <FieldLabel htmlFor="dt-req-user">{t.workEmail}</FieldLabel>
                <div className="flex min-w-0 items-center overflow-hidden rounded-[8px] border border-input bg-field focus-within:border-ring focus-within:shadow-[0_0_0_3px_var(--dt-hover)]">
                  <input
                    id="dt-req-user"
                    type="text"
                    placeholder="yusuf.aydin"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={`min-w-0 flex-1 bg-transparent px-[11px] text-[13px] text-fg outline-none ${
                      touch ? 'h-[46px]' : 'h-[38px]'
                    }`}
                  />
                  <span
                    className={`flex shrink-0 items-center border-l border-input bg-surface px-[11px] font-mono text-[11.5px] text-muted-fg ${
                      touch ? 'h-[46px]' : 'h-[38px]'
                    }`}
                  >
                    {DOMAIN}
                  </span>
                </div>
                <span className="font-mono text-[9px] tracking-[0.06em] text-muted-fg">{t.usernameHint}</span>
              </div>

              <div className="flex flex-col gap-[6px]">
                <Caps className="text-[10px] font-medium tracking-[0.12em] text-muted-fg">
                  {t.department}
                </Caps>
                <SegBar>
                  {DEPARTMENTS.map((d) => (
                    <SegButton key={d} active={department === d} onClick={() => setDepartment(d)}>
                      {d}
                    </SegButton>
                  ))}
                </SegBar>
              </div>

              <div className="flex flex-col gap-[6px]">
                <Caps className="text-[10px] font-medium tracking-[0.12em] text-muted-fg">
                  {t.accessNeeded}
                </Caps>
                <SegBar>
                  {ROLES.map((r) => (
                    <SegButton key={r} active={role === r} onClick={() => setRole(r)}>
                      {r}
                    </SegButton>
                  ))}
                </SegBar>
              </div>

              <div className="flex flex-col gap-[6px]">
                <FieldLabel htmlFor="dt-req-note">{t.whichSites}</FieldLabel>
                <textarea
                  id="dt-req-note"
                  rows={3}
                  placeholder={t.egReason}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full min-w-0 resize-y rounded-[8px] border border-input bg-field px-[11px] py-[9px] text-[12.5px] leading-[1.5] text-fg outline-none focus:border-ring focus:shadow-[0_0_0_3px_var(--dt-hover)]"
                />
              </div>

              <div className="flex flex-col gap-[9px]">
                <Button onClick={() => void submit()} disabled={busy}>
                  {t.submitRequest}
                </Button>
                <Button variant="secondary" onClick={() => router.push('/signin')}>
                  {t.backToSignIn}
                </Button>
              </div>
            </div>
          )}
        </AuthCard>
      </div>

      <AuthFooter protectedUpper={t.protectedUpper} signature={t.signature} />
    </AuthShell>
  );
}
