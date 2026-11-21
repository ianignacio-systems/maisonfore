import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Signing in with the Maison account: the Supabase project's sign-in (today the MaisonPOS project), so one
 * email and password work in MaisonPOS and MaisonFore. Without Supabase settings, local trials sign in
 * with any email (the server must run with MAISON_DEV_AUTH=1).
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
export const LOCAL = !supabase;

const DEV_KEY = 'fore.devEmail';

export async function token(): Promise<string | null> {
  if (supabase) return (await supabase.auth.getSession()).data.session?.access_token ?? null;
  try { const e = localStorage.getItem(DEV_KEY); return e ? `dev:${e}` : null; } catch { return null; }
}

export async function currentEmail(): Promise<string | null> {
  if (supabase) return (await supabase.auth.getSession()).data.session?.user.email ?? null;
  try { return localStorage.getItem(DEV_KEY); } catch { return null; }
}

export async function signIn(email: string, password: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
    return;
  }
  try { localStorage.setItem(DEV_KEY, email.trim().toLowerCase()); } catch { /* private window */ }
}

export async function signUp(email: string, password: string): Promise<string> {
  if (!supabase) { await signIn(email, password); return ''; }
  const { error, data } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
  if (error) throw new Error(error.message);
  return data.session ? '' : `We sent a link to ${email}. Open it to confirm your email, then sign in.`;
}

export async function resetPassword(email: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
  try { localStorage.removeItem(DEV_KEY); } catch { /* ignore */ }
}

/** The reset-password link signs the person in to choose a new password. */
export function onPasswordRecovery(fn: () => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') fn(); });
  return () => data.subscription.unsubscribe();
}

export async function setNewPassword(password: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

export function onAuthChange(fn: () => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange(() => fn());
  return () => data.subscription.unsubscribe();
}
