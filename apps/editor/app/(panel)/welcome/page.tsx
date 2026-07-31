import { redirect } from 'next/navigation';
import { SetPasswordScreen } from '@panel/components/auth/set-password-screen';
import { getSession } from '@panel/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * First sign-in, reachable two ways:
 *   /welcome?token=…  an invited account opening its emailed link
 *   /welcome          a signed-in account carrying must_change_password
 *
 * Neither is reachable by accident: without a token and without that flag there
 * is nothing to set up, so the visitor goes wherever they actually belong.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (token) return <SetPasswordScreen token={token} requestedMode="welcome" />;

  const session = await getSession({ touch: false });
  if (!session) redirect('/signin');
  if (session.mfaPending) redirect('/mfa');
  if (!session.user.mustChangePassword) redirect('/console/overview');

  return (
    <SetPasswordScreen token={null} requestedMode="welcome" identity={session.user.username} />
  );
}
