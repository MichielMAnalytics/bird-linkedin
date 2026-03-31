/**
 * Base LinkedIn client with sophisticated anti-detection:
 * - Full browser-like headers matching a real Chrome 146 session
 * - Cookie jar that collects & persists authenticated browser cookies
 * - Persistent session identity (clientUuid, pageInstanceId, resolution)
 * - Runtime clientVersion scraping from LinkedIn's frontend JS
 * - Anti-detection jitter for mutations
 * - Manual redirect handling (captures Set-Cookie on 302s)
 * - Init sequence that runs on first request
 *
 * Matches the sophistication of bird-rebuilt's twitter-client-base.ts.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { getSessionIdentity, updateSessionFields, type SessionData } from './session-store.js';
import { collectBrowserCookies, buildCookieHeader, updateJarFromResponse } from './cookie-jar.js';
import {
  CLIENT_VERSION,
  USER_AGENT,
  SEC_CH_UA,
  SEC_CH_UA_MOBILE,
  SEC_CH_UA_PLATFORM,
  ACCEPT_GRAPHQL,
  ACCEPT_REST,
  ACCEPT_HTML,
  ACCEPT_LANGUAGE,
  ACCEPT_ENCODING,
  VOYAGER_API_BASE,
  GRAPHQL_ENDPOINT,
  LINKEDIN_BASE,
  MAX_REDIRECTS,
} from './linkedin-client-constants.js';

export interface LinkedInCredentials {
  liAt: string;      // li_at session cookie (httpOnly)
  jsessionId: string; // JSESSIONID csrf token
}

export interface LinkedInClientOptions {
  credentials: LinkedInCredentials;
  timeout?: number;
  noJitter?: boolean;
  lang?: string;     // x-li-lang value (default: en_US)
}

export class LinkedInClientBase {
  protected credentials: LinkedInCredentials;
  protected timeout: number;
  protected noJitter: boolean;
  protected lang: string;

  /** Session identity (persisted to disk). */
  protected session!: SessionData;

  /** Resolved clientVersion (scraped at runtime, falls back to constant). */
  protected clientVersion: string = CLIENT_VERSION;

  /** Full cookie header string, rebuilt after every response. */
  protected cookieHeader: string;

  /** @internal */ _initialized = false;
  /** @internal */ _initPromise: Promise<void> | null = null;

  /** Rate limiter: timestamps of recent requests. */
  private _requestTimestamps: number[] = [];
  private _maxRequestsPerMinute = 30;

  static readonly API_BASE = VOYAGER_API_BASE;
  static readonly GRAPHQL_ENDPOINT = GRAPHQL_ENDPOINT;

  constructor(options: LinkedInClientOptions) {
    this.credentials = options.credentials;
    this.timeout = options.timeout ?? 30_000;
    this.noJitter = options.noJitter ?? false;
    this.lang = options.lang ?? process.env.LI_LANG ?? 'en_US';
    this._maxRequestsPerMinute = parseInt(process.env.LI_RATE_LIMIT || '30', 10);

    // Minimal cookie header until init runs
    const csrfToken = this.credentials.jsessionId.replace(/^"|"$/g, '');
    this.cookieHeader = `li_at=${this.credentials.liAt}; JSESSIONID="${csrfToken}"`;
  }

  // ── Initialization ────────────────────────────────────────

  /**
   * Lazy init sequence (runs once on first request):
   * 1. Load persistent session identity (stable clientUuid + pageInstanceId + resolution)
   * 2. Collect authenticated browser cookies from linkedin.com homepage
   * 3. Scrape current clientVersion from LinkedIn's frontend JS
   * 4. Build full cookie header
   */
  async init(): Promise<void> {
    if (this._initialized) return;
    if (!this._initPromise) {
      this._initPromise = (async () => {
        // 1. Load persistent session
        try {
          this.session = await getSessionIdentity();
        } catch {
          // Fallback inline session
          this.session = {
            clientUuid: randomUUID(),
            pageInstanceId: randomBytes(16).toString('base64'),
            displayWidth: 3024,
            displayHeight: 1964,
            displayDensity: 2,
            createdAt: new Date().toISOString(),
          };
        }

        // 2. Collect authenticated browser cookies
        try {
          await collectBrowserCookies(
            this.credentials.liAt,
            this.credentials.jsessionId
          );
          this.cookieHeader = buildCookieHeader(
            this.credentials.liAt,
            this.credentials.jsessionId
          );
        } catch {}

        // 3. Scrape clientVersion from LinkedIn's frontend
        try {
          await this.scrapeClientVersion();
        } catch {}

        this._initialized = true;
      })();
    }
    await this._initPromise;
  }

  /** @internal */
  protected async ensureInit(): Promise<void> {
    if (!this._initialized) await this.init();
  }

  // ── Runtime Version Discovery ─────────────────────────────

  /**
   * Fetch the LinkedIn feed page and extract the current clientVersion
   * from embedded JS bundles or the page source.
   * This keeps the version in sync even when LinkedIn ships new builds.
   */
  private async scrapeClientVersion(): Promise<void> {
    try {
      const res = await fetch(`${LINKEDIN_BASE}/feed/`, {
        method: 'GET',
        headers: {
          'user-agent': USER_AGENT,
          'accept': ACCEPT_HTML,
          'accept-language': ACCEPT_LANGUAGE,
          'accept-encoding': 'identity', // we need to read the body as text
          'cookie': this.cookieHeader,
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
          'sec-ch-ua': SEC_CH_UA,
          'sec-ch-ua-mobile': SEC_CH_UA_MOBILE,
          'sec-ch-ua-platform': SEC_CH_UA_PLATFORM,
        },
        redirect: 'follow',
      });

      if (!res.ok) return;

      const html = await res.text();

      // Strategy 1: Look for clientVersion in a JSON config block
      // e.g. "clientVersion":"1.13.43122.3"
      const versionMatch = html.match(/"clientVersion"\s*:\s*"([\d.]+)"/);
      if (versionMatch) {
        this.clientVersion = versionMatch[1];
        await updateSessionFields({ clientVersion: this.clientVersion });
        return;
      }

      // Strategy 2: Look for mpVersion
      const mpMatch = html.match(/"mpVersion"\s*:\s*"([\d.]+)"/);
      if (mpMatch) {
        this.clientVersion = mpMatch[1];
        await updateSessionFields({ clientVersion: this.clientVersion });
        return;
      }

      // Strategy 3: If we have a cached version from session, use it
      if (this.session.clientVersion) {
        this.clientVersion = this.session.clientVersion;
      }
    } catch {
      // Fall back to session-stored or constant version
      if (this.session?.clientVersion) {
        this.clientVersion = this.session.clientVersion;
      }
    }
  }

  // ── Headers ───────────────────────────────────────────────

  /**
   * Compute the timezone offset in hours (matching JS `new Date().getTimezoneOffset() / -60`).
   * LinkedIn expects the offset as an integer.
   */
  private getTimezoneInfo(): { timezone: string; timezoneOffset: number } {
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // getTimezoneOffset returns minutes *behind* UTC, so negate and convert to hours
      const timezoneOffset = -(new Date().getTimezoneOffset() / 60);
      return { timezone, timezoneOffset };
    } catch {
      return { timezone: 'America/Los_Angeles', timezoneOffset: -8 };
    }
  }

  /**
   * Build the x-li-track JSON payload that mimics LinkedIn's frontend telemetry.
   */
  private buildLiTrack(): string {
    const { timezone, timezoneOffset } = this.getTimezoneInfo();
    return JSON.stringify({
      clientVersion: this.clientVersion,
      mpVersion: this.clientVersion,
      osName: 'web',
      timezoneOffset,
      timezone,
      deviceFormFactor: 'DESKTOP',
      mpName: 'voyager-web',
      displayDensity: this.session?.displayDensity ?? 2,
      displayWidth: this.session?.displayWidth ?? 3024,
      displayHeight: this.session?.displayHeight ?? 1964,
    });
  }

  /**
   * Build a page instance URN.
   * Format: urn:li:page:d_flagship3_feed;<base64-random>==
   */
  private buildPageInstance(page = 'd_flagship3_feed'): string {
    const suffix = this.session?.pageInstanceId ?? randomBytes(16).toString('base64');
    return `urn:li:page:${page};${suffix}`;
  }

  /**
   * Build the complete set of browser-like headers for LinkedIn REST API requests.
   * These match a real Chrome 146 session exactly.
   */
  protected getHeaders(method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET'): Record<string, string> {
    // Strip surrounding quotes but keep the ajax: prefix.
    // JSESSIONID value is typically "ajax:1234567890" — csrf-token header uses the same value unquoted.
    const csrfToken = this.credentials.jsessionId.replace(/^"|"$/g, '');

    const headers: Record<string, string> = {
      // LinkedIn-specific headers (order matters for fingerprint)
      'csrf-token': csrfToken,
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': this.lang,
      'x-li-track': this.buildLiTrack(),
      'x-li-page-instance': this.buildPageInstance(),

      // Color scheme preference
      'sec-ch-prefers-color-scheme': 'light',

      // Accept for REST
      'accept': ACCEPT_REST,

      // Standard browser headers
      'user-agent': USER_AGENT,
      'accept-language': ACCEPT_LANGUAGE,
      'accept-encoding': ACCEPT_ENCODING,

      // Client Hints (Chrome sends these)
      'sec-ch-ua': SEC_CH_UA,
      'sec-ch-ua-mobile': SEC_CH_UA_MOBILE,
      'sec-ch-ua-platform': SEC_CH_UA_PLATFORM,

      // Sec-Fetch metadata (browser security headers)
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',

      // Priority (Chrome 146 sends this)
      'priority': 'u=1, i',

      // Referer (always feed)
      'referer': `${LINKEDIN_BASE}/feed/`,

      // Full cookie jar
      'cookie': this.cookieHeader,
    };

    // Origin header only on mutating methods (POST, PUT, DELETE)
    if (method !== 'GET') {
      headers['origin'] = LINKEDIN_BASE;
    }

    return headers;
  }

  /**
   * Build headers for GraphQL endpoints.
   * The only difference from REST is the accept header.
   */
  protected getGraphQLHeaders(method: 'GET' | 'POST' = 'GET'): Record<string, string> {
    const headers = this.getHeaders(method);
    headers['accept'] = ACCEPT_GRAPHQL;
    return headers;
  }

  /**
   * Headers for HTML page requests (search page scraping, etc.).
   */
  protected getPageHeaders(): Record<string, string> {
    return {
      'user-agent': USER_AGENT,
      'accept': ACCEPT_HTML,
      'accept-language': ACCEPT_LANGUAGE,
      'accept-encoding': ACCEPT_ENCODING,
      'cookie': this.cookieHeader,
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
      'sec-ch-ua': SEC_CH_UA,
      'sec-ch-ua-mobile': SEC_CH_UA_MOBILE,
      'sec-ch-ua-platform': SEC_CH_UA_PLATFORM,
      'sec-ch-prefers-color-scheme': 'light',
      'upgrade-insecure-requests': '1',
      'cache-control': 'max-age=0',
      'referer': `${LINKEDIN_BASE}/feed/`,
      'priority': 'u=0, i',
    };
  }

  // ── Jitter ────────────────────────────────────────────────

  /**
   * Anti-detection jitter: random 2-5 second delay before mutations.
   */
  protected async mutationJitter(): Promise<void> {
    if (this.noJitter) return;
    const ms = 2000 + Math.random() * 3000;
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Rate Limiting ─────────────────────────────────────────

  /**
   * Wait if needed to stay within the rate limit (default: 30 req/min).
   * Configurable via LI_RATE_LIMIT env var.
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const windowMs = 60_000;

    // Prune timestamps older than 1 minute
    this._requestTimestamps = this._requestTimestamps.filter(t => now - t < windowMs);

    if (this._requestTimestamps.length >= this._maxRequestsPerMinute) {
      const oldest = this._requestTimestamps[0];
      const waitMs = windowMs - (now - oldest) + 100; // +100ms buffer
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
      // Re-prune after waiting
      this._requestTimestamps = this._requestTimestamps.filter(t => Date.now() - t < windowMs);
    }

    this._requestTimestamps.push(Date.now());
  }

  // ── Fetch ─────────────────────────────────────────────────

  /**
   * Internal fetch that:
   * - Enforces rate limiting (default 30 req/min)
   * - Uses redirect: 'manual' to capture Set-Cookie on 302s
   * - Follows up to MAX_REDIRECTS manually, merging cookies each time
   * - Checks for session invalidation (li_at=delete me)
   * - Supports timeout via AbortController
   */
  protected async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    await this.enforceRateLimit();
    let currentUrl = url;

    for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
      let response: Response;

      // Always use manual redirect so we can capture Set-Cookie
      const fetchInit: RequestInit = {
        ...init,
        redirect: 'manual',
      };

      if (this.timeout && this.timeout > 0) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);
        try {
          response = await fetch(currentUrl, { ...fetchInit, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      } else {
        response = await fetch(currentUrl, fetchInit);
      }

      // Check for session invalidation (LinkedIn sends li_at=delete me)
      const setCookies = response.headers.getSetCookie?.() ?? [];
      const sessionKilled = setCookies.some(c => c.startsWith('li_at=delete'));
      if (sessionKilled) {
        throw new Error(
          'LinkedIn session invalidated (li_at cookie rejected). ' +
          'Your li_at token has expired or been revoked. ' +
          'Please get fresh credentials from Chrome DevTools -> Application -> Cookies -> linkedin.com'
        );
      }

      // Capture Set-Cookie from every response (updates jar + persists)
      try {
        updateJarFromResponse(response.headers);
        this.cookieHeader = buildCookieHeader(
          this.credentials.liAt,
          this.credentials.jsessionId
        );
      } catch {}

      // Update headers with new cookie for next redirect
      if (init.headers && typeof init.headers === 'object' && !Array.isArray(init.headers)) {
        (init.headers as Record<string, string>)['cookie'] = this.cookieHeader;
      }

      // If not a redirect, return the response
      if (response.status < 300 || response.status >= 400) {
        return response;
      }

      // Handle redirect
      const location = response.headers.get('location');
      if (!location) return response;

      // Resolve relative URLs
      currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).toString();
    }

    throw new Error(
      `Too many redirects (${MAX_REDIRECTS}) for ${url}. ` +
      'This usually means LinkedIn is blocking the request. Check your credentials.'
    );
  }

  // ── API Methods ───────────────────────────────────────────

  /**
   * GET a REST API path (relative to VOYAGER_API_BASE).
   */
  protected async apiGet(path: string, params?: Record<string, string>): Promise<any> {
    await this.ensureInit();

    let url = `${VOYAGER_API_BASE}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += (url.includes('?') ? '&' : '?') + qs;
    }

    const res = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: this.getHeaders('GET'),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LinkedIn API error ${res.status}: ${text.substring(0, 300)}`);
    }

    return await res.json();
  }

  /**
   * POST to a REST API path (relative to VOYAGER_API_BASE).
   */
  protected async apiPost(path: string, body: any): Promise<any> {
    await this.ensureInit();
    await this.mutationJitter();

    const url = `${VOYAGER_API_BASE}${path}`;

    const headers = {
      ...this.getHeaders('POST'),
      'content-type': 'application/json',
    };

    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LinkedIn API error ${res.status}: ${text.substring(0, 300)}`);
    }

    return await res.json();
  }

  /**
   * GET from the GraphQL endpoint.
   *
   * LinkedIn's GraphQL uses a custom variables format: (key:value,nested:(foo:bar))
   * NOT standard JSON. The `variables` parameter should already be in this format.
   *
   * @param variables - LinkedIn parentheses-encoded variables string, e.g. "(vanityName:johndoe)"
   * @param queryId - Recipe name + hash, e.g. "voyagerIdentityDashProfiles.abc123"
   * @param includeWebMetadata - Whether to add includeWebMetadata=true
   */
  protected async graphqlGet(
    variables: string,
    queryId: string,
    includeWebMetadata = false
  ): Promise<any> {
    await this.ensureInit();

    // Build the URL manually to avoid double-encoding the parentheses
    const parts: string[] = [];
    if (includeWebMetadata) {
      parts.push('includeWebMetadata=true');
    }
    parts.push(`variables=${encodeURIComponent(variables)}`);
    parts.push(`queryId=${encodeURIComponent(queryId)}`);

    const url = `${GRAPHQL_ENDPOINT}?${parts.join('&')}`;

    const res = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: this.getGraphQLHeaders('GET'),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LinkedIn GraphQL error ${res.status}: ${text.substring(0, 300)}`);
    }

    return await res.json();
  }

  /**
   * Fetch a raw URL (for endpoints with special query string formatting).
   * Uses full REST API headers.
   */
  protected async rawGet(fullUrl: string): Promise<any> {
    await this.ensureInit();

    const res = await this.fetchWithTimeout(fullUrl, {
      method: 'GET',
      headers: this.getHeaders('GET'),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LinkedIn API error ${res.status}: ${text.substring(0, 300)}`);
    }

    return await res.json();
  }

  /**
   * Fetch a raw URL with GraphQL accept headers.
   */
  protected async rawGraphqlGet(fullUrl: string): Promise<any> {
    await this.ensureInit();

    const res = await this.fetchWithTimeout(fullUrl, {
      method: 'GET',
      headers: this.getGraphQLHeaders('GET'),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LinkedIn GraphQL error ${res.status}: ${text.substring(0, 300)}`);
    }

    return await res.json();
  }

  /**
   * Fetch an HTML page (for search scraping).
   * Uses page/document headers instead of API headers.
   */
  protected async pageGet(fullUrl: string): Promise<string> {
    await this.ensureInit();

    const res = await this.fetchWithTimeout(fullUrl, {
      method: 'GET',
      headers: this.getPageHeaders(),
    });

    if (!res.ok) {
      throw new Error(`LinkedIn page error ${res.status}`);
    }

    return await res.text();
  }
}
