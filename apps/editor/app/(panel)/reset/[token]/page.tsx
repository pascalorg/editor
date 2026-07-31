import { SetPasswordScreen } from '@panel/components/auth/set-password-screen';

export const dynamic = 'force-dynamic';

export default async function SetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SetPasswordScreen token={token} requestedMode="reset" />;
}
