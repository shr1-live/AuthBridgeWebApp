import { InjectionToken } from '@angular/core';

export interface AppConfig {
  /** Render backend origin, no trailing slash. */
  apiBaseUrl: string;
  /**
   * 'supabase' signs in through Supabase Auth. 'localDev' uses the backend's Development-only
   * token endpoint and exists so the workflow can run before the Supabase project is wired up;
   * the backend refuses it outside Development.
   */
  authMode: 'supabase' | 'localDev';
  supabaseUrl: string;
  /** Publishable (anon) key only. Never a secret or service-role key. */
  supabasePublishableKey: string;
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');
