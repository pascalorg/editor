import { redirect } from 'next/navigation';
import { getSession } from '@panel/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Route guard for everything under /console — the server-side counterpart of the
 * old client-bootstrap. It runs before any console markup exists, so an
 * unauthenticated visitor never sees a frame of the shell.
 *
 * Order matters: a half-open (MFA-owed) session is not signed in, and an account
 * owing a password change cannot reach the console until it sets one.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) redirect('/signin');
  if (session.mfaPending) redirect('/mfa');
  if (session.user.mustChangePassword) redirect('/welcome');

  return <>{children}</>;
}
