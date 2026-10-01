import { AppConfig, forgetBackendUrl, resolveConfig, saveBackendUrl } from './config';

const built: AppConfig = { apiBaseUrl: 'https://authbridge-api.onrender.com', authMode: 'demo' };

describe('backend URL override', () => {
  afterEach(() => forgetBackendUrl());

  it('uses the built URL until the viewer saves another', () => {
    expect(resolveConfig(built).apiBaseUrl).toBe('https://authbridge-api.onrender.com');
    expect(saveBackendUrl(' https://my-api.onrender.com/some/path ')).toBeNull();
    expect(resolveConfig(built).apiBaseUrl).toBe('https://my-api.onrender.com');
  });

  it('refuses plain http except for localhost, and junk', () => {
    expect(saveBackendUrl('http://my-api.onrender.com')).toContain('https://');
    expect(saveBackendUrl('not a url')).toContain('full URL');
    expect(saveBackendUrl('http://localhost:5243')).toBeNull();
    expect(resolveConfig(built).apiBaseUrl).toBe('http://localhost:5243');
  });

  it('forgets the override', () => {
    saveBackendUrl('https://my-api.onrender.com');
    forgetBackendUrl();
    expect(resolveConfig(built).apiBaseUrl).toBe(built.apiBaseUrl);
  });
});
