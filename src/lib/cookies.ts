/**
 * Resolve LinkedIn credentials from CLI flags or environment variables.
 */

import { LinkedInCredentials } from './linkedin-client-base.js';

export interface ResolveOptions {
  liAt?: string;
  jsessionId?: string;
}

export function resolveCredentials(options: ResolveOptions): LinkedInCredentials {
  const liAt = options.liAt
    || process.env.LI_AT
    || process.env.LINKEDIN_LI_AT
    || '';

  const jsessionId = options.jsessionId
    || process.env.JSESSIONID
    || process.env.LINKEDIN_JSESSIONID
    || '';

  if (!liAt) {
    throw new Error(
      'Missing li_at cookie. Set LI_AT env var or use --li-at flag.\n' +
      'To get it: Chrome DevTools → Application → Cookies → linkedin.com → li_at'
    );
  }

  if (!jsessionId) {
    throw new Error(
      'Missing JSESSIONID cookie. Set JSESSIONID env var or use --jsessionid flag.\n' +
      'To get it: Chrome DevTools → Application → Cookies → linkedin.com → JSESSIONID'
    );
  }

  return { liAt, jsessionId };
}
