/**
 * Google sign-in through Supabase Auth (PKCE, system browser). Works in Expo Go and in builds.
 * Supabase only proves who the user is; the Sherpa server then checks its allowlist and issues the
 * Sherpa session. The Supabase anon key is public by design (it identifies the project, nothing more).
 */
import 'react-native-url-polyfill/auto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

WebBrowser.maybeCompleteAuthSession();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** SecureStore caps values at ~2 KB; Supabase sessions can be larger, so they are chunked. */
const secureStorage = {
  async getItem(key: string) {
    const n = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? 0);
    if (!n) return null;
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`)));
    return parts.join('');
  },
  async setItem(key: string, value: string) {
    const chunks = value.match(/.{1,1800}/gs) ?? [];
    await Promise.all(chunks.map((c, i) => SecureStore.setItemAsync(`${key}.${i}`, c)));
    await SecureStore.setItemAsync(`${key}.n`, String(chunks.length));
  },
  async removeItem(key: string) {
    const n = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? 0);
    await Promise.all([...Array.from({ length: n }, (_, i) => SecureStore.deleteItemAsync(`${key}.${i}`)), SecureStore.deleteItemAsync(`${key}.n`)]);
  },
};

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
      })
    : null;

export class GoogleSignInCancelled extends Error {}

/** Opens Google in the system browser and returns a Supabase access token for the server to verify. */
export async function signInWithGoogle(): Promise<string> {
  if (!supabase) throw new Error('Google sign-in is not configured for this build.');
  const redirectTo = Linking.createURL('auth/callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error || !data.url) throw new Error(error?.message ?? 'Could not start Google sign-in.');
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') throw new GoogleSignInCancelled('Sign-in was cancelled.');
  const params = new URL(result.url).searchParams;
  const code = params.get('code');
  if (!code) throw new Error(params.get('error_description') ?? 'Google did not return a sign-in code.');
  const { data: session, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !session.session) throw new Error(exchangeError?.message ?? 'Sign-in failed.');
  return session.session.access_token;
}

export async function signOutOfSupabase() {
  await supabase?.auth.signOut().catch(() => undefined);
}

/** The exact redirect URL this build uses — add it to Supabase → Authentication → URL Configuration. */
export const googleRedirectUrl = () => Linking.createURL('auth/callback');
