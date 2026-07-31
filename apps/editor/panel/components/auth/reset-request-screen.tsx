'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@panel/components/app-providers';
import { AuthFooter, AuthShell } from '@panel/components/auth/auth-shell';
import { AuthCard, Button, Field, FieldLabel } from '@panel/components/ui/controls';
import { ErrorBox, ScreenTitle, SuccessMark } from '@panel/components/ui/feedback';
import { call } from '@panel/lib/client-api';
import type { ResetRequestResponse } from '@panel/lib/api-contract';
import { resolveApiMessage } from '@panel/lib/i18n';

export function ResetRequestScreen() {
  const { t } = useApp();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (!email.trim()) {
      setError(t.errFields);
      return;
    }

    setBusy(true);
    setError(null);
    const res = await call<ResetRequestResponse>('/api/auth/reset', { body: { email: email.trim() } });
    setBusy(false);

    // The endpoint answers 202 for every address that parses, so the only way to
    // land here is a malformed address or a dead network — never "no such user".
    if (!res.ok) {
      setError(resolveApiMessage(t, res.messageKey));
      return;
    }
    setSent(true);
  }, [email, t]);

  return (
    <AuthShell label="Password reset">
      <AuthCard>
        {sent ? (
          <div className="flex flex-col gap-5">
            <SuccessMark />
            <div className="flex flex-col gap-[5px]">
              <h1 className="m-0 text-[18px] font-semibold tracking-[-0.01em]">{t.inboxTitle}</h1>
              <p className="m-0 text-[12.5px] leading-[1.55] text-muted-fg">{t.inboxLead}</p>
              <span className="font-mono text-[11px] text-fg">{email.trim()}</span>
            </div>
            <Button variant="secondary" onClick={() => router.push('/signin')}>
              {t.backToSignIn}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <ScreenTitle title={t.resetTitle} lead={t.resetLead} />
            </div>

            {error ? <ErrorBox shield={false}>{error}</ErrorBox> : null}

            <div className="flex flex-col gap-[6px]">
              <FieldLabel htmlFor="dt-reset-email">{t.emailLabel}</FieldLabel>
              <Field
                id="dt-reset-email"
                type="email"
                autoComplete="email"
                placeholder="name@netlog.com.tr"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </div>

            <div className="flex flex-col gap-[9px]">
              <Button onClick={() => void submit()} disabled={busy}>
                {t.resetCta}
              </Button>
              <Button variant="secondary" onClick={() => router.push('/signin')}>
                {t.backToSignIn}
              </Button>
            </div>
          </div>
        )}
      </AuthCard>

      <AuthFooter protectedUpper={t.protectedUpper} signature={t.signature} />
    </AuthShell>
  );
}
