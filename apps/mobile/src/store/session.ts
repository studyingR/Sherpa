import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import type { ResolvedFlags, User } from '@sherpa/shared';

const KEY = 'sherpa.session';

interface SessionState {
  ready: boolean;
  token: string | null;
  user: User | null;
  features: ResolvedFlags | null;
  hydrate(): Promise<void>;
  signIn(token: string, user: User): Promise<void>;
  setFeatures(f: ResolvedFlags): void;
  signOut(): Promise<void>;
}

/** Session token lives in the secure keychain (expo-secure-store), never in plain storage. */
export const useSession = create<SessionState>((set) => ({
  ready: false,
  token: null,
  user: null,
  features: null,
  async hydrate() {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) {
        const { token, user } = JSON.parse(raw) as { token: string; user: User };
        set({ token, user });
      }
    } finally {
      set({ ready: true });
    }
  },
  async signIn(token, user) {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ token, user }));
    set({ token, user });
  },
  setFeatures(features) {
    set({ features });
  },
  async signOut() {
    await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
    set({ token: null, user: null, features: null });
  },
}));

export function useFeature(name: keyof ResolvedFlags): boolean {
  return useSession((s) => Boolean(s.features?.[name]));
}
