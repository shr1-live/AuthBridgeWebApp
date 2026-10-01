import { InjectionToken } from '@angular/core';

export interface AppConfig {
  /** Render backend origin, no trailing slash. */
  apiBaseUrl: string;
  /** Built-in synthetic demo sign-in on Render, or the equivalent local endpoint. */
  authMode: 'demo' | 'localDev';
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');

const BACKEND_KEY = 'authbridge.apiBaseUrl';

/**
 * The build bakes in a default backend URL. If the Render service lives elsewhere, the sign-in
 * page lets the viewer paste the right one; it is remembered in this browser and wins here.
 */
export function resolveConfig(built: AppConfig): AppConfig {
  const saved = storedBackendUrl();
  return saved ? { ...built, apiBaseUrl: saved } : built;
}

export function storedBackendUrl(): string | null {
  try {
    return localStorage.getItem(BACKEND_KEY);
  } catch {
    return null;
  }
}

/** Normalises and stores a backend URL; returns an error message or null. */
export function saveBackendUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return 'Enter a full URL, for example https://authbridgewebapi.onrender.com';
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return 'The backend URL must start with https://';
  try {
    localStorage.setItem(BACKEND_KEY, url.origin);
  } catch {
    return 'This browser blocks storage, so the backend URL cannot be remembered.';
  }
  return null;
}

export function forgetBackendUrl(): void {
  try {
    localStorage.removeItem(BACKEND_KEY);
  } catch {
    // Nothing stored.
  }
}
