import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../config';

export interface LocalDevUser {
  subjectId: string;
  tenantId: string;
  role: string;
  isActive: boolean;
  displayLabel: string;
}

const LOCAL_DEV_KEY = 'authbridge.localDevSession';

interface LocalDevSession {
  accessToken: string;
  expiresAt: number;
  label: string;
}

/**
 * Sign-in state. In 'supabase' mode the Supabase client owns the session: it persists it
 * with its supported storage and refreshes the access token itself; nothing custom stores
 * tokens. 'localDev' mode (backend Development only) keeps a short-lived token in
 * sessionStorage so the workflow can run before the Supabase project is configured.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly config = inject(APP_CONFIG);
  private readonly router = inject(Router);
  private supabase: SupabaseClient | null = null;

  private readonly identity = signal<string | null>(null);
  readonly signedIn = computed(() => this.identity() !== null);
  readonly label = this.identity.asReadonly();
  readonly mode = this.config.authMode;

  async init(): Promise<void> {
    if (this.config.authMode === 'supabase') {
      // Loaded on demand so local-dev builds and first paint do not carry the client.
      const { createClient } = await import('@supabase/supabase-js');
      this.supabase = createClient(this.config.supabaseUrl, this.config.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
      const { data } = await this.supabase.auth.getSession();
      this.identity.set(data.session?.user.email ?? (data.session ? 'Signed in' : null));
      this.supabase.auth.onAuthStateChange((event, session) => {
        this.identity.set(session?.user.email ?? (session ? 'Signed in' : null));
        if (event === 'SIGNED_OUT') void this.router.navigate(['/login']);
      });
    } else {
      const session = this.readLocal();
      this.identity.set(session?.label ?? null);
    }
  }

  async signInWithPassword(email: string, password: string): Promise<string | null> {
    if (!this.supabase) return 'Supabase sign-in is not configured for this build.';
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }

  async localDevUsers(): Promise<LocalDevUser[]> {
    const response = await fetch(`${this.config.apiBaseUrl}/dev/users`);
    if (!response.ok) throw new Error(`Local sign-in unavailable (${response.status}).`);
    return (await response.json()) as LocalDevUser[];
  }

  async signInLocalDev(user: LocalDevUser): Promise<string | null> {
    const response = await fetch(`${this.config.apiBaseUrl}/dev/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId: user.subjectId }),
    });
    if (!response.ok) return `Sign-in failed (${response.status}).`;
    const body = (await response.json()) as { accessToken: string; expiresIn: number };
    const session: LocalDevSession = {
      accessToken: body.accessToken,
      expiresAt: Date.now() + body.expiresIn * 1000,
      label: user.displayLabel,
    };
    sessionStorage.setItem(LOCAL_DEV_KEY, JSON.stringify(session));
    this.identity.set(session.label);
    return null;
  }

  /** Current access token; the Supabase client refreshes it transparently when near expiry. */
  async accessToken(): Promise<string | null> {
    if (this.supabase) {
      const { data } = await this.supabase.auth.getSession();
      return data.session?.access_token ?? null;
    }
    const session = this.readLocal();
    if (!session) {
      this.identity.set(null);
      return null;
    }
    return session.accessToken;
  }

  /** Forces a refresh after a 401. Returns false when the session cannot be renewed. */
  async refresh(): Promise<boolean> {
    if (!this.supabase) return false;
    const { data, error } = await this.supabase.auth.refreshSession();
    return !error && !!data.session;
  }

  async signOut(reason?: 'expired'): Promise<void> {
    // Leave the current page first: clearing the session while it is still mounted would
    // re-render it once without a token and fire unauthenticated requests.
    await this.router.navigate(['/login'], { queryParams: reason ? { reason } : {} });
    if (this.supabase) await this.supabase.auth.signOut();
    sessionStorage.removeItem(LOCAL_DEV_KEY);
    this.identity.set(null);
  }

  private readLocal(): LocalDevSession | null {
    try {
      const raw = sessionStorage.getItem(LOCAL_DEV_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw) as LocalDevSession;
      if (session.expiresAt <= Date.now() + 5_000) {
        sessionStorage.removeItem(LOCAL_DEV_KEY);
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }
}
