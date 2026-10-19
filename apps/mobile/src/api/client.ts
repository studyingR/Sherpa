import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ErrorBody } from '@sherpa/shared';
import { useSession } from '@/store/session';

/**
 * Server base URL. EXPO_PUBLIC_API_URL wins; otherwise use the dev machine's address from Expo (works on the
 * iOS simulator and on a phone on the same Wi-Fi). The app never talks to OpenAI or external systems directly.
 */
export function apiBase(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host ?? 'localhost'}:4000`;
}

export function wsBase(): string {
  return apiBase().replace(/^http/, 'ws');
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const token = useSession.getState().token;
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/v1${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Sherpa can't reach the server right now.");
  }
  if (res.status === 401) {
    useSession.getState().signOut();
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (json as ErrorBody | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Something went wrong. Try again.', e?.details);
  }
  return json as T;
}

/** Offline read cache (M8): last good copy of Today and viewed briefs. */
const CACHE_PREFIX = 'sherpa.cache.';
export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T & { __offline?: boolean }> {
  try {
    const data = await fn();
    AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data)).catch(() => undefined);
    return data as T & { __offline?: boolean };
  } catch (err) {
    if (err instanceof ApiError && err.isNetwork) {
      const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
      if (raw) return { ...(JSON.parse(raw) as T), __offline: true };
    }
    throw err;
  }
}

export async function clearCache() {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(CACHE_PREFIX));
  await AsyncStorage.multiRemove(keys);
}
