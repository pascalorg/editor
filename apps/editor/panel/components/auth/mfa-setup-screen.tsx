'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { QrCode } from 'lucide-react';
import { useApp } from '@panel/components/app-providers';
import { AuthFooter, AuthShell } from '@panel/components/auth/auth-shell';
import { OtpInput } from '@panel/components/auth/otp-input';
import { AuthCard, Button, Checkbox } from '@panel/components/ui/controls';
import { ErrorBox, Kicker, ScreenTitle } from '@panel/components/ui/feedback';
import { call } from '@panel/lib/client-api';
import type { MfaSetupResponse, MfaVerifyResponse } from '@panel/lib/api-contract';
import { resolveApiMessage } from '@panel/lib/i18n';
import { Caps } from '@panel/components/ui/caps';

type Step = 'scan' | 'verify' | 'codes';

export function MfaSetupScreen() {
  const { t } = useApp();
  const router = useRouter();

  const [step, setStep] = useState<Step>('scan');
  const [qr, setQr] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState('');
  const [code, setCode] = useState<string[]>(Array(6).fill(''));
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [stored, setStored] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await call<MfaSetupResponse>('/api/mfa/setup', { body: {} });
      if (!res.ok) {
        if (res.code === 'unauthenticated') {
          router.replace('/signin');
          return;
        }
        // Already enrolled — the code screen is the right place, not setup.
        if (res.code === 'conflict') {
          router.replace('/mfa');
          return;
        }
        setError(resolveApiMessage(t, res.messageKey));
        return;
      }
      setQr(res.data.qrDataUrl);
      setManualKey(res.data.manualKey);
    })();
    // Runs once: a re-run would mint a new secret mid-enrolment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = useCallback(
    async (joined?: string) => {
      const value = joined ?? code.join('');
      if (value.length !== 6) {
        setError(t.muCodeErr);
        return;
      }

      setBusy(true);
      setError(null);
      const res = await call<MfaVerifyResponse>('/api/mfa/verify', { body: { code: value, trustDevice: false } });
      setBusy(false);

      if (!res.ok) {
        setError(resolveApiMessage(t, res.messageKey, { seconds: Number(res.details.retryAfterSeconds ?? 30) }));
        setCode(Array(6).fill(''));
        return;
      }

      setRecoveryCodes(res.data.recoveryCodes ?? []);
      setStep('codes');
    },
    [code, t],
  );

  const copyKey = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(manualKey.replace(/\s/g, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the key is on screen to type by hand */
    }
  }, [manualKey]);

  const downloadCodes = useCallback(() => {
    const body =
      `DigitalTwin — recovery codes\n` +
      `Each code works once. Store them somewhere safe and offline.\n\n` +
      recoveryCodes.map((c) => `  ${c}`).join('\n') +
      `\n`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'digitaltwin-recovery-codes.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [recoveryCodes]);

  const title = step === 'scan' ? t.muTitleScan : step === 'verify' ? t.muTitleVerify : t.muTitleCodes;
  const lead = step === 'scan' ? t.muLeadScan : step === 'verify' ? t.muLeadVerify : t.muLeadCodes;

  return (
    <AuthShell label="2FA setup">
      <AuthCard gap={18}>
        <div className="flex flex-col gap-[3px]">
          <Kicker>{t.muKick}</Kicker>
          <ScreenTitle title={title} lead={lead} />
        </div>

        {error ? <ErrorBox shield={false}>{error}</ErrorBox> : null}

        {step === 'scan' ? (
          <>
            <div className="flex items-stretch gap-[14px]">
              <div className="flex h-[118px] w-[118px] shrink-0 flex-col items-center justify-center gap-[6px] rounded-[10px] border border-dashed border-input bg-field text-muted-fg">
                {qr ? (
                  <Image src={qr} alt={t.muQr} width={106} height={106} unoptimized className="rounded-[4px] bg-white p-1" />
                ) : (
                  <>
                    <QrCode className="block h-[26px] w-[26px]" strokeWidth={1.8} />
                    <Caps className="font-mono text-[8.5px] tracking-[0.12em]">{t.muQr}</Caps>
                  </>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                <Caps className="text-[10px] font-medium tracking-[0.12em] text-muted-fg">
                  {t.muManual}
                </Caps>
                <span className="break-all font-mono text-xs tracking-[0.04em] text-fg">{manualKey || '····'}</span>
                <button
                  type="button"
                  onClick={() => void copyKey()}
                  className="h-[26px] self-start rounded-[7px] border border-input bg-field px-[10px] text-[11px] font-medium text-fg hover:bg-hover"
                >
                  {copied ? t.muCopied : t.muCopy}
                </button>
              </div>
            </div>
            <Button onClick={() => setStep('verify')} disabled={!manualKey}>
              {t.muContinue}
            </Button>
          </>
        ) : null}

        {step === 'verify' ? (
          <>
            <OtpInput value={code} onChange={setCode} onComplete={(joined) => void verify(joined)} invalid={Boolean(error)} />
            <div className="flex flex-col gap-[10px]">
              <Button onClick={() => void verify()} disabled={busy}>
                {t.muVerify}
              </Button>
              <button
                type="button"
                onClick={() => setStep('scan')}
                className="bg-transparent text-[11.5px] text-muted-fg hover:text-fg"
              >
                {t.muBack}
              </button>
            </div>
          </>
        ) : null}

        {step === 'codes' ? (
          <>
            <div className="grid grid-cols-2 gap-[6px] rounded-[10px] border border-border bg-field p-3">
              {recoveryCodes.map((rc) => (
                <span key={rc} className="font-mono text-[11.5px] tracking-[0.05em] text-fg">
                  {rc}
                </span>
              ))}
            </div>
            <Button variant="secondary" onClick={downloadCodes}>
              {t.muDownload}
            </Button>
            <Checkbox checked={stored} onChange={setStored}>
              {t.muSavedLbl}
            </Checkbox>
            {/* The finish button stays inert until the codes are acknowledged —
                the one place in the flow where a checkbox is a real gate. */}
            <div
              className="flex flex-col"
              style={{ opacity: stored ? 1 : 0.45, pointerEvents: stored ? 'auto' : 'none' }}
            >
              <Button onClick={() => router.push('/console/overview')}>{t.muFinish}</Button>
            </div>
          </>
        ) : null}
      </AuthCard>

      <AuthFooter protectedUpper={t.protectedUpper} signature={t.signature} />
    </AuthShell>
  );
}
