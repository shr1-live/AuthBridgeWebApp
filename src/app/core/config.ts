import { InjectionToken } from '@angular/core';

export interface AppConfig {
  /** Render backend origin, no trailing slash. */
  apiBaseUrl: string;
  /** Built-in synthetic demo sign-in on Render, or the equivalent local endpoint. */
  authMode: 'demo' | 'localDev';
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');
