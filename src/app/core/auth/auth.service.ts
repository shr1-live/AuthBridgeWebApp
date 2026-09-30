import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
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

  private readonly identity = signal<string | null>(null);
  readonly signedIn = computed(() => this.identity() !== null);
  readonly label = this.identity.asReadonly();
  readonly mode = this.config.authMode;

  async init(): Promise<void> {
    const session = this.readLocal();
    this.identity.set(session?.label ?? null);
  }

  async localDevUsers(): Promise<LocalDevUser[]> {
    const response = await fetch(`${this.config.apiBaseUrl}/${this.config.authMode === 'demo' ? 'demo' : 'dev'}/users`);
    if (!response.ok) throw new Error(`Local sign-in unavailable (${response.status}).`);
    return (await response.json()) as LocalDevUser[];
  }

  async signInLocalDev(user: LocalDevUser): Promise<string | null> {
    const response = await fetch(`${this.config.apiBaseUrl}/${this.config.authMode === 'demo' ? 'demo' : 'dev'}/token`, {
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

  /** Current short-lived demo access token. */
  async accessToken(): Promise<string | null> {
    const session = this.readLocal();
    if (!session) {
      this.identity.set(null);
      return null;
    }
    return session.accessToken;
  }

  /** Forces a refresh after a 401. Returns false when the session cannot be renewed. */
  async refresh(): Promise<boolean> {
    return false;
  }

  async signOut(reason?: 'expired'): Promise<void> {
    // Leave the current page first: clearing the session while it is still mounted would
    // re-render it once without a token and fire unauthenticated requests.
    await this.router.navigate(['/login'], { queryParams: reason ? { reason } : {} });
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
