import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { api, ApiError, setUnauthorizedHandler } from './api';
import type { Me, Permission } from './types';

type AuthState =
  | { status: 'loading' }
  /** Signed in to Supabase, but not an admin — a distinct state, not an error. */
  | { status: 'not-admin'; email: string }
  | { status: 'anonymous' }
  | { status: 'ready'; me: Me; session: Session };

interface AuthContextValue {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: Permission) => boolean;
  me: Me | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      supabase.auth.signOut().finally(() => setState({ status: 'anonymous' }));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function resolve(session: Session | null) {
      if (!session) {
        if (!cancelled) setState({ status: 'anonymous' });
        return;
      }
      try {
        const me = await api.get<Me>('/me');
        if (!cancelled) setState({ status: 'ready', me, session });
      } catch (err) {
        if (cancelled) return;
        // 403 here is the ordinary case of a real user who is not staff. It
        // gets its own screen rather than a redirect loop back to the login
        // form they just completed successfully.
        if (err instanceof ApiError && err.status === 403) {
          setState({ status: 'not-admin', email: session.user.email ?? '' });
        } else {
          setState({ status: 'anonymous' });
        }
      }
    }

    supabase.auth.getSession().then(({ data }) => resolve(data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // TOKEN_REFRESHED fires on a timer; re-resolving would refetch /me every
      // hour for no reason and flash the shell.
      if (event === 'TOKEN_REFRESHED') return;
      resolve(session);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const me = state.status === 'ready' ? state.me : null;
    return {
      state,
      me,
      can: (permission) => !!me?.permissions.includes(permission),
      async signIn(email, password) {
        setState({ status: 'loading' });
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setState({ status: 'anonymous' });
          throw new Error(error.message);
        }
      },
      async signOut() {
        await supabase.auth.signOut();
        setState({ status: 'anonymous' });
      },
    };
  }, [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Convenience for the common `can('x') && <button/>` pattern. */
export function useCan() {
  return useAuth().can;
}
