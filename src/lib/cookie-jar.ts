/**
 * Cookie jar for LinkedIn anti-detection.
 *
 * On init, fetches linkedin.com homepage WITH the user's auth cookies (li_at + JSESSIONID)
 * to collect a full set of authenticated browser cookies.  Follows redirects manually
 * to capture Set-Cookie headers from every hop.  Persists the full cookie jar to disk
 * and updates it from every API response.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  USER_AGENT,
  SEC_CH_UA,
  SEC_CH_UA_MOBILE,
  SEC_CH_UA_PLATFORM,
  ACCEPT_HTML,
  ACCEPT_LANGUAGE,
  ACCEPT_ENCODING,
} from './linkedin-client-constants.js';

const COOKIE_PATH = path.join(homedir(), '.config', 'bird-linkedin', 'cookies.json');
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours — refresh more aggressively than 24h

interface CookieJarData {
  cookies: Record<string, string>;
  collectedAt: string;
}

let jar: Record<string, string> | null = null;
let collectedAt = 0;

// ── Persistence ──────────────────────────────────────────────────────

async function readJar(): Promise<CookieJarData | null> {
  try {
    const raw = await readFile(COOKIE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data?.cookies && typeof data.cookies === 'object') return data as CookieJarData;
  } catch {}
  return null;
}

async function writeJar(data: CookieJarData): Promise<void> {
  await mkdir(path.dirname(COOKIE_PATH), { recursive: true });
  await writeFile(COOKIE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ── Set-Cookie parsing ───────────────────────────────────────────────

function parseSetCookieHeaders(headers: Headers): Record<string, string> {
  const cookies: Record<string, string> = {};
  const raw = headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const eqIdx = cookie.indexOf('=');
    if (eqIdx === -1) continue;
    const name = cookie.substring(0, eqIdx).trim();
    const rest = cookie.substring(eqIdx + 1);
    const semiIdx = rest.indexOf(';');
    const value = semiIdx === -1 ? rest.trim() : rest.substring(0, semiIdx).trim();
    if (name && value) cookies[name] = value;
  }
  return cookies;
}

/**
 * Merge Set-Cookie headers from any API response into the jar.
 * Called after every fetch to keep cookies fresh (Cloudflare __cf_bm, lidc, etc.).
 */
export function updateJarFromResponse(headers: Headers): void {
  const incoming = parseSetCookieHeaders(headers);
  if (Object.keys(incoming).length === 0) return;
  if (!jar) jar = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (value === 'delete me' || value === '"delete me"' || value === '""') {
      delete jar[name];
    } else {
      jar[name] = value;
    }
  }
  // Persist in background
  writeJar({ cookies: jar, collectedAt: new Date().toISOString() }).catch(() => {});
}

/**
 * Collect browser cookies by fetching the LinkedIn homepage WITH auth cookies.
 * This gives us an authenticated session's full cookie set (bcookie, bscookie,
 * li_gc, li_mc, lidc, __cf_bm, timezone, lang, _pxvid, dfpfpt, etc.).
 *
 * Follows up to 5 redirects manually to capture Set-Cookie on every hop
 * (LinkedIn 302s to /feed/ for authenticated users).
 */
export async function collectBrowserCookies(liAt?: string, jsessionId?: string): Promise<void> {
  const now = Date.now();

  // If we already collected recently, skip
  if (jar && (now - collectedAt) < MAX_AGE_MS) return;

  // Try loading from disk first
  if (!jar) {
    const fromDisk = await readJar();
    if (fromDisk) {
      const diskAge = now - new Date(fromDisk.collectedAt).getTime();
      if (diskAge < MAX_AGE_MS) {
        jar = fromDisk.cookies;
        collectedAt = now - diskAge;
        return;
      }
      // Even if expired, seed the jar with old values for continuity
      jar = fromDisk.cookies;
    }
  }

  if (!jar) jar = {};

  // Build the cookie header for the homepage request.
  // Include auth cookies so we get the full authenticated set.
  const seedCookies: string[] = [];
  if (liAt) seedCookies.push(`li_at=${liAt}`);
  if (jsessionId) {
    const csrf = jsessionId.replace(/^"|"$/g, '');
    seedCookies.push(`JSESSIONID="${csrf}"`);
  }
  // Include existing jar cookies too (for continuity)
  for (const [name, value] of Object.entries(jar)) {
    if (name === 'li_at' || name === 'JSESSIONID') continue;
    seedCookies.push(`${name}=${value}`);
  }

  const cookieHeader = seedCookies.join('; ');

  const pageHeaders: Record<string, string> = {
    'user-agent': USER_AGENT,
    'accept': ACCEPT_HTML,
    'accept-language': ACCEPT_LANGUAGE,
    'accept-encoding': ACCEPT_ENCODING,
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'sec-ch-ua': SEC_CH_UA,
    'sec-ch-ua-mobile': SEC_CH_UA_MOBILE,
    'sec-ch-ua-platform': SEC_CH_UA_PLATFORM,
    'upgrade-insecure-requests': '1',
    'cache-control': 'max-age=0',
  };

  if (cookieHeader) {
    pageHeaders['cookie'] = cookieHeader;
  }

  try {
    let currentUrl = 'https://www.linkedin.com/';
    const maxRedirects = 5;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const response = await fetch(currentUrl, {
        method: 'GET',
        headers: pageHeaders,
        redirect: 'manual',
      });

      // Collect Set-Cookie from this hop
      const incoming = parseSetCookieHeaders(response.headers);
      for (const [name, value] of Object.entries(incoming)) {
        if (value !== 'delete me' && value !== '"delete me"' && value !== '""') {
          jar![name] = value;
        }
      }

      // Update the cookie header for the next hop
      const nextCookieParts: string[] = [];
      if (liAt) nextCookieParts.push(`li_at=${liAt}`);
      if (jsessionId) {
        const csrf = jsessionId.replace(/^"|"$/g, '');
        nextCookieParts.push(`JSESSIONID="${csrf}"`);
      }
      for (const [name, value] of Object.entries(jar!)) {
        if (name === 'li_at' || name === 'JSESSIONID') continue;
        nextCookieParts.push(`${name}=${value}`);
      }
      pageHeaders['cookie'] = nextCookieParts.join('; ');

      // Follow redirect?
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) {
          currentUrl = location.startsWith('http')
            ? location
            : new URL(location, currentUrl).toString();
          // For same-origin redirects, update sec-fetch-site
          pageHeaders['sec-fetch-site'] = 'same-origin';
          continue;
        }
      }
      break; // Not a redirect, we are done
    }

    collectedAt = Date.now();
    await writeJar({ cookies: jar!, collectedAt: new Date().toISOString() }).catch(() => {});
  } catch {
    // Graceful degradation: use whatever we have
    collectedAt = Date.now();
  }
}

/**
 * Build a full cookie header string by merging jar cookies with auth cookies.
 * Auth cookies (li_at, JSESSIONID) always override jar values.
 *
 * Maintains the same cookie ordering a real browser would send:
 * bcookie, bscookie, li_gc, ... auth cookies, ... trailing cookies
 */
export function buildCookieHeader(liAt: string, jsessionId: string): string {
  const parts: string[] = [];

  // Add jar cookies first (browser-collected)
  if (jar) {
    for (const [name, value] of Object.entries(jar)) {
      // Don't duplicate auth cookies — we add them explicitly
      if (name === 'li_at' || name === 'JSESSIONID') continue;
      parts.push(`${name}=${value}`);
    }
  }

  // Always include auth cookies (user-provided)
  const csrfToken = jsessionId.replace(/^"|"$/g, '');
  parts.push(`li_at=${liAt}`);
  parts.push(`JSESSIONID="${csrfToken}"`);

  return parts.join('; ');
}

/**
 * Get a specific cookie from the jar.
 */
export function getJarCookie(name: string): string | null {
  return jar?.[name] ?? null;
}

/**
 * Try to extract a clientVersion from an sdui_ver cookie value.
 * Example: sdui_ver=sdui-flagship:0.1.31107+SduiFlagship0
 * The "31107" portion maps to the minor build in clientVersion.
 * Returns null if not found.
 */
export function extractVersionFromSduiCookie(): string | null {
  const sdui = jar?.['sdui_ver'];
  if (!sdui) return null;
  // Format: sdui-flagship:0.1.NNNNN+SduiFlagship0
  const match = sdui.match(/sdui-flagship:[\d.]+\+/);
  return match ? sdui : null; // Return raw for logging; actual version scraped from JS
}
