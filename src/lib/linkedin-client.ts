/**
 * Full LinkedIn client with all API methods.
 * Uses the sophisticated anti-detection base class.
 *
 * Endpoint strategy:
 * - GraphQL: GET /voyager/api/graphql?variables=(...)&queryId=recipeName.hash
 * - REST:    GET /voyager/api/... (some legacy endpoints still work)
 * - HTML:    GET https://www.linkedin.com/search/... (scraping for search)
 *
 * Variables use LinkedIn's custom parentheses format: (key:value,nested:(foo:bar))
 */

import { LinkedInClientBase } from './linkedin-client-base.js';
import { updateSessionFields } from './session-store.js';
import {
  QUERY_IDS,
  VOYAGER_API_BASE,
  GRAPHQL_ENDPOINT,
  LINKEDIN_BASE,
} from './linkedin-client-constants.js';
import {
  PostData,
  CommentData,
  ProfileData,
  parsePostsFromIncluded,
  parseCommentsFromIncluded,
  parseProfileFromGraphQL,
  parsePostId,
  activityUrn,
  normalizeHandle,
} from './linkedin-client-utils.js';

export class LinkedInClient extends LinkedInClientBase {

  // ── Auth / Identity ──────────────────────────────────────

  /**
   * Get current authenticated user info.
   *
   * Tries the REST /me endpoint first (still works for basic identity),
   * then falls back to the GraphQL mySettings recipe.
   */
  async getMe(): Promise<{
    firstName: string;
    lastName: string;
    publicIdentifier: string;
    entityUrn: string;
    plainId: number;
  }> {
    // Try REST /me first — this is the most reliable identity endpoint
    try {
      const data = await this.apiGet('/me');
      const mini = data.included?.find((i: any) => i['$type']?.includes('MiniProfile'));
      const me = data.data || data;

      const result = {
        firstName: mini?.firstName || me.miniProfile?.firstName || me.firstName || '',
        lastName: mini?.lastName || me.miniProfile?.lastName || me.lastName || '',
        publicIdentifier: mini?.publicIdentifier || me.miniProfile?.publicIdentifier || me.publicIdentifier || '',
        entityUrn: mini?.entityUrn || me.miniProfile?.entityUrn || me.entityUrn || '',
        plainId: me.plainId || 0,
      };

      // Store memberIdentity in session for future use
      if (result.entityUrn) {
        const memberIdMatch = result.entityUrn.match(/urn:li:fsd_profile:([^)]+)/);
        if (memberIdMatch) {
          await updateSessionFields({ memberIdentity: memberIdMatch[1] }).catch(() => {});
        }
      }

      return result;
    } catch {
      // Fall through to GraphQL
    }

    // Fallback: GraphQL mySettings
    const data = await this.graphqlGet(
      '()',
      QUERY_IDS.mySettings,
      true
    );

    // mySettings has a different response shape
    const me = data?.data?.mySettingsByMySettings || data?.data || {};
    return {
      firstName: me.firstName || '',
      lastName: me.lastName || '',
      publicIdentifier: me.publicIdentifier || '',
      entityUrn: me.entityUrn || '',
      plainId: me.plainId || 0,
    };
  }

  // ── Profile ──────────────────────────────────────────────

  /**
   * Get a user profile by public identifier (vanity name).
   *
   * Strategy:
   * 1. Scrape the profile HTML page (most reliable — matches normal browser traffic)
   * 2. Extract name from <title>, URN from page source, headline/location from meta/embedded data
   * 3. Fall back to Voyager REST endpoint if scraping fails
   */
  async getProfile(publicId: string): Promise<ProfileData | null> {
    const handle = normalizeHandle(publicId);

    // Strategy 1: Scrape the profile HTML page (stealthiest approach)
    try {
      const html = await this.pageGet(`${LINKEDIN_BASE}/in/${encodeURIComponent(handle)}/`);
      const profile = this.parseProfileFromHtml(html, handle);
      if (profile) return profile;
    } catch {
      // Fall through
    }

    // Strategy 2: Voyager REST endpoint (may be deprecated for some profiles)
    try {
      const url = `${VOYAGER_API_BASE}/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(handle)}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-20`;
      const data = await this.rawGet(url);

      const included = data.included || [];
      const profileEl = included.find((i: any) =>
        i['$type']?.includes('Profile') && i.firstName
      );

      if (!profileEl) return null;

      return {
        id: profileEl.entityUrn || '',
        firstName: profileEl.firstName || '',
        lastName: profileEl.lastName || '',
        headline: profileEl.headline || profileEl.occupation || '',
        publicIdentifier: profileEl.publicIdentifier || handle,
        entityUrn: profileEl.entityUrn || '',
        location: profileEl.geoLocation?.geo?.defaultLocalizedName,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse profile data from the LinkedIn profile HTML page.
   * Extracts name from <title>, URN from embedded data, headline from page content.
   */
  private parseProfileFromHtml(html: string, handle: string): ProfileData | null {
    // Name from title: "FirstName LastName | LinkedIn" or "FirstName LastName - Title | LinkedIn"
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (!titleMatch) return null;

    const titleText = titleMatch[1].replace(/\s*\|\s*LinkedIn\s*$/, '').trim();
    if (!titleText || titleText === 'LinkedIn') return null;

    // Title can be "First Last" or "First Last - Headline"
    const dashIdx = titleText.indexOf(' - ');
    let fullName: string;
    let headline = '';
    if (dashIdx > 0) {
      fullName = titleText.substring(0, dashIdx).trim();
      headline = titleText.substring(dashIdx + 3).trim();
    } else {
      fullName = titleText;
    }

    const nameParts = fullName.split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Profile URN (first fsd_profile URN found is typically the page owner)
    const urnMatch = html.match(/urn:li:fsd_profile:([A-Za-z0-9_-]+)/);
    const entityUrn = urnMatch ? `urn:li:fsd_profile:${urnMatch[1]}` : '';

    // Location from meta or page content
    const locationMatch = html.match(/"locationName"\s*:\s*"([^"]+)"/) ||
      html.match(/"geoLocationName"\s*:\s*"([^"]+)"/);
    const location = locationMatch?.[1];

    // Try to get a better headline from embedded data
    if (!headline) {
      const headlineMatch = html.match(/"headline"\s*:\s*"([^"]+)"/) ||
        html.match(/"occupation"\s*:\s*"([^"]+)"/);
      if (headlineMatch) headline = headlineMatch[1];
    }

    return {
      id: entityUrn,
      firstName,
      lastName,
      headline,
      publicIdentifier: handle,
      entityUrn,
      location,
    };
  }

  // ── Feed ─────────────────────────────────────────────────

  /**
   * Get the home feed.
   *
   * The real frontend uses a GraphQL recipe voyagerFeedDashRelevanceFeedByHomeV2.
   * Falls back to the legacy chronFeed REST endpoint if GraphQL fails.
   */
  async getHomeFeed(count = 10, _start = 0): Promise<PostData[]> {
    // Try GraphQL feed endpoint
    try {
      const variables = `(count:${count})`;
      const data = await this.graphqlGet(
        variables,
        QUERY_IDS.feedHome,
        true
      );

      // GraphQL feed has a different response shape — try to extract from included
      if (data.included) {
        const posts = parsePostsFromIncluded(data.included);
        if (posts.length > 0) return posts;
      }

      // Also try the data.data path
      const elements = data?.data?.feedDashRelevanceFeedByHomeV2ByHomeV2?.elements;
      if (elements) {
        const posts = parsePostsFromIncluded(elements);
        if (posts.length > 0) return posts;
      }
    } catch {
      // Fall through to REST
    }

    // Fallback: Legacy REST endpoint
    try {
      const url = `${VOYAGER_API_BASE}/feed/updates?q=chronFeed&moduleKey=home-feed&count=${count}&start=${_start}`;
      const data = await this.rawGet(url);
      return parsePostsFromIncluded(data.included);
    } catch {
      // Fall through to another legacy endpoint
    }

    // Fallback 2: feed/dash endpoint
    const url = `${VOYAGER_API_BASE}/feed/dash/updates?q=homeFeed&moduleKey=home-feed&count=${count}&start=${_start}`;
    const data = await this.rawGet(url);
    return parsePostsFromIncluded(data.included);
  }

  /**
   * Get posts from a specific user.
   *
   * The real frontend fetches user posts via the profile activities page,
   * which yields activity URNs we can then look up.
   */
  async getUserPosts(publicId: string, count = 10, start = 0): Promise<PostData[]> {
    const handle = normalizeHandle(publicId);

    // Try the legacy memberShareFeed REST endpoint first
    try {
      const url = `${VOYAGER_API_BASE}/feed/updates?q=memberShareFeed&profileId=${encodeURIComponent(handle)}&moduleKey=member-share&count=${count}&start=${start}`;
      const data = await this.rawGet(url);
      const posts = parsePostsFromIncluded(data.included);
      if (posts.length > 0) return posts;
    } catch {
      // Fall through
    }

    // Fallback: Scrape the user's activity page for activity URNs
    try {
      const activityUrl = `${LINKEDIN_BASE}/in/${encodeURIComponent(handle)}/recent-activity/all/`;
      const html = await this.pageGet(activityUrl);

      const activityUrns = [...new Set(html.match(/urn:li:activity:\d+/g) || [])];
      if (activityUrns.length === 0) return [];

      const limited = activityUrns.slice(0, count);
      const posts: PostData[] = [];

      for (const urn of limited) {
        try {
          const data = await this.rawGet(`${VOYAGER_API_BASE}/feed/updates/${urn}`);
          const parsed = parsePostsFromIncluded(data.included);
          if (parsed.length > 0) posts.push(parsed[0]);
        } catch {
          // Skip failed fetches
        }
      }

      return posts;
    } catch {
      return [];
    }
  }

  // ── Post Detail ──────────────────────────────────────────

  /**
   * Get a single post with its comments.
   */
  async getPost(postIdOrUrl: string): Promise<{ post: PostData | null; comments: CommentData[] }> {
    const id = parsePostId(postIdOrUrl);
    const urn = activityUrn(id);

    // Try REST feed/updates endpoint
    try {
      const data = await this.rawGet(`${VOYAGER_API_BASE}/feed/updates/${urn}`);
      const posts = parsePostsFromIncluded(data.included);
      const comments = parseCommentsFromIncluded(data.included);
      return { post: posts[0] || null, comments };
    } catch {
      // Fall through
    }

    // Fallback: try dash endpoint
    try {
      const data = await this.rawGet(
        `${VOYAGER_API_BASE}/feed/dash/updates/${encodeURIComponent(urn)}`
      );
      const posts = parsePostsFromIncluded(data.included);
      const comments = parseCommentsFromIncluded(data.included);
      return { post: posts[0] || null, comments };
    } catch {
      return { post: null, comments: [] };
    }
  }

  /**
   * Get comments on a post.
   */
  async getComments(postIdOrUrl: string): Promise<CommentData[]> {
    const id = parsePostId(postIdOrUrl);
    const urn = activityUrn(id);

    try {
      const data = await this.rawGet(`${VOYAGER_API_BASE}/feed/updates/${urn}`);
      return parseCommentsFromIncluded(data.included);
    } catch {
      return [];
    }
  }

  // ── Search ───────────────────────────────────────────────

  /**
   * Search for posts/content on LinkedIn.
   * Scrapes activity URNs from the HTML search page, then fetches each via API.
   * Uses full browser-like page headers for the HTML request.
   */
  async searchPosts(keywords: string, count = 10, _start = 0): Promise<PostData[]> {
    const encodedKeywords = encodeURIComponent(keywords);

    // Fetch search results HTML page using pageGet (browser-like headers)
    const searchUrl = `${LINKEDIN_BASE}/search/results/content/?keywords=${encodedKeywords}&origin=GLOBAL_SEARCH_HEADER`;

    const html = await this.pageGet(searchUrl);

    // Extract activity URNs from HTML
    const activityUrns = [...new Set(html.match(/urn:li:activity:\d+/g) || [])];
    if (activityUrns.length === 0) return [];

    // Fetch details for each post via the Voyager API
    const limited = activityUrns.slice(0, count);
    const posts: PostData[] = [];

    for (const urn of limited) {
      try {
        const data = await this.rawGet(`${VOYAGER_API_BASE}/feed/updates/${urn}`);
        const parsed = parsePostsFromIncluded(data.included);
        if (parsed.length > 0) posts.push(parsed[0]);
      } catch {
        // Skip failed fetches
      }
    }

    return posts;
  }

  /**
   * Search for people on LinkedIn.
   *
   * Scrapes the people search results HTML page and parses structured
   * person cards directly from the page text. This extracts name, headline,
   * location, current role, and handle — no per-profile API calls needed.
   *
   * LinkedIn's SDUI renders cards with a consistent text pattern:
   *   Name \n • 1ste/2de/3de+\n\nHeadline\n\nLocation\n\nHuidig: Role bij Company
   */
  async searchPeople(keywords: string, count = 10): Promise<ProfileData[]> {
    const encodedKeywords = encodeURIComponent(keywords);

    const searchUrl = `${LINKEDIN_BASE}/search/results/people/?keywords=${encodedKeywords}&origin=GLOBAL_SEARCH_HEADER`;
    const html = await this.pageGet(searchUrl);

    // Strategy 1: Parse structured text from the rendered page.
    // The SDUI page embeds visible text in a predictable card pattern.
    // We pair each /in/ handle with its surrounding card text.
    const profiles = this.parsePeopleSearchResults(html, count);
    if (profiles.length > 0) return profiles;

    // Strategy 2 (fallback): just extract handles and look them up individually.
    const handles = [...new Set(
      (html.match(/\/in\/([a-zA-Z0-9_-]{3,})/g) || [])
        .map(m => m.replace('/in/', ''))
        .filter(h => h !== 'me')
    )];

    const fallbackProfiles: ProfileData[] = [];
    for (const handle of handles.slice(0, count)) {
      try {
        const profile = await this.getProfile(handle);
        if (profile) fallbackProfiles.push(profile);
      } catch {}
    }
    return fallbackProfiles;
  }

  /**
   * Parse people search results from LinkedIn's SDUI HTML.
   *
   * The page contains <a href="/in/handle"> links, and the visible page text
   * (extracted via a simple tag stripper) has structured person cards.
   * We match handles to their card text by proximity in the HTML.
   */
  private parsePeopleSearchResults(html: string, count: number): ProfileData[] {
    // Step 1: Extract handle→name pairs from the HTML.
    // LinkedIn SDUI renders <a href="/in/handle">...<span>Name</span>...</a>
    // We find each /in/ link and look for the person's name near it.
    const handleNamePairs: Array<{ handle: string; htmlIndex: number }> = [];
    const seenHandles = new Set<string>();
    const handleRegex = /\/in\/([a-zA-Z0-9_-]{3,})(?:\/|"|')/g;
    let hMatch;
    while ((hMatch = handleRegex.exec(html)) !== null) {
      const h = hMatch[1];
      if (!seenHandles.has(h) && h !== 'me') {
        seenHandles.add(h);
        handleNamePairs.push({ handle: h, htmlIndex: hMatch.index });
      }
    }

    // Step 2: Strip RSC payload before parsing visible text.
    // RSC data lives in <script> tags and after the closing </html>.
    // Also strip everything that looks like serialized JSON/RSC.
    let cleanHtml = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')  // Remove all scripts
      .replace(/\$L[0-9a-f]+/g, '')  // Remove RSC references
      .split('</html>')[0] || html;  // Only keep content before </html>

    // Strip HTML tags to get visible text
    const visibleText = cleanHtml
      .replace(/<(br|div|p|li|h[1-6]|section|tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n');

    // Step 3: Parse person cards from visible text.
    // Pattern: "Name • 1ste/2de/3de+"
    const cardRegex = /([A-Z\u00C0-\u024F][^\n]{1,49}?)\s*[•·]\s*(?:1ste|2de|3de\+|1st|2nd|3rd\+)/g;
    const cards: Array<{
      name: string;
      headline: string;
      location: string;
      currentRole: string;
    }> = [];

    let match;
    while ((match = cardRegex.exec(visibleText)) !== null) {
      const name = match[1].trim();
      // Filter out RSC garbage: names must start with a letter, no special chars
      if (name.length < 2 || name.length > 55) continue;
      if (/[{}\[\]$\\]/.test(name)) continue;  // RSC artifacts
      if (/^\d/.test(name)) continue;           // Starts with number

      // Parse the next ~400 chars for headline, location, current role
      const afterCard = visibleText.substring(match.index + match[0].length, match.index + match[0].length + 400);
      const lines = afterCard.split('\n').map(l => l.trim()).filter(l => l && l.length > 2);

      let headline = '';
      let location = '';
      let currentRole = '';

      const skipPattern = /^(Bericht|Volgen|Connectie|Message|Follow|Connect|gemeenschappelijke|\d+K? volgers|meldingen|Overslaan|Mijn services|Zijn deze)/;
      const locationPattern = /Nederland|Netherlands|Rotterdam|Amsterdam|Utrecht|Den Haag|Randstad|België|Belgium|London|United Kingdom|Verenigde Staten|United States|India|Germany|France|Singapore|España|Spanje|New York|en omgeving/;

      for (const line of lines.slice(0, 10)) {
        if (/[{}\[\]$\\]/.test(line)) break;  // Hit RSC data, stop
        if (skipPattern.test(line)) continue;

        if (line.startsWith('Huidig:') || line.startsWith('Current:') || line.startsWith('Vorig:') || line.startsWith('Previous:')) {
          currentRole = line;
          break;
        }

        // Headline comes FIRST (it's the line right after name+degree)
        // Location comes SECOND (it has geographic keywords)
        if (!headline) {
          headline = line;
        } else if (!location && locationPattern.test(line)) {
          location = line;
        }
      }

      cards.push({ name, headline, location, currentRole });
    }

    // Step 4: Match cards to handles.
    // Try to match by name similarity first, then by order.
    const profiles: ProfileData[] = [];
    const usedHandles = new Set<string>();
    const orderedHandles = handleNamePairs.map(p => p.handle);

    for (const card of cards) {
      if (profiles.length >= count) break;

      let bestHandle = '';

      // Match by name parts appearing in handle
      for (const h of orderedHandles) {
        if (usedHandles.has(h)) continue;
        const hLower = h.toLowerCase();
        const nameParts = card.name.toLowerCase().split(/\s+/);
        if (nameParts.some(part => part.length > 2 && hLower.includes(part))) {
          bestHandle = h;
          break;
        }
      }

      // Fallback: next unused handle
      if (!bestHandle) {
        for (const h of orderedHandles) {
          if (!usedHandles.has(h)) {
            bestHandle = h;
            break;
          }
        }
      }

      if (!bestHandle) continue;
      usedHandles.add(bestHandle);

      const nameParts = card.name.split(/\s+/);
      profiles.push({
        id: '',
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' ') || '',
        headline: card.headline || card.currentRole || '',
        publicIdentifier: bestHandle,
        entityUrn: '',
        location: card.location || undefined,
      });
    }

    return profiles;
  }

  // ── Commenting ───────────────────────────────────────────

  /**
   * Resolve an activity ID/URL to the ugcPost threadUrn needed for comments.
   * The mapping lives in updateMetadata.shareUrn of the feed/updates response.
   */
  private async resolveThreadUrn(postIdOrUrl: string): Promise<string> {
    const id = parsePostId(postIdOrUrl);
    const urn = activityUrn(id);

    const data = await this.rawGet(`${VOYAGER_API_BASE}/feed/updates/${urn}`);
    const included = data.included || [];

    // Find the UpdateV2 entity and extract shareUrn from updateMetadata
    // LinkedIn uses both urn:li:ugcPost:xxx and urn:li:share:xxx
    for (const item of included) {
      const shareUrn = item.updateMetadata?.shareUrn;
      if (shareUrn && (shareUrn.includes('ugcPost') || shareUrn.includes('share'))) {
        return shareUrn;
      }
    }

    // Fallback: search all included for a ugcPost or share URN
    const allJson = JSON.stringify(included);
    const match = allJson.match(/urn:li:(?:ugcPost|share):\d+/);
    if (match) return match[0];

    throw new Error(`Could not resolve threadUrn for activity ${id}`);
  }

  /**
   * Reply to a post (add a comment).
   *
   * Uses the voyagerSocialDashNormComments endpoint discovered from the real browser.
   */
  async replyToPost(postIdOrUrl: string, text: string): Promise<{ success: boolean; commentUrn?: string; error?: string }> {
    await this.ensureInit();
    await this.mutationJitter();

    try {
      const threadUrn = await this.resolveThreadUrn(postIdOrUrl);

      const body = {
        commentary: {
          text,
          attributesV2: [],
          '$type': 'com.linkedin.voyager.dash.common.text.TextViewModel',
        },
        threadUrn,
      };

      const url = `${VOYAGER_API_BASE}/voyagerSocialDashNormComments?decorationId=com.linkedin.voyager.dash.deco.social.NormComment-43`;
      const res = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { success: false, error: `HTTP ${res.status}: ${errText.substring(0, 200)}` };
      }

      const result = await res.json().catch(() => ({})) as any;
      const commentUrn = result?.data?.entityUrn || result?.data?.['*elements']?.[0] || '';

      return { success: true, commentUrn };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Reactions ────────────────────────────────────────────

  /**
   * React to a post (like, celebrate, love, insightful, funny, support).
   *
   * LinkedIn reaction types:
   *   LIKE        - 👍 Like
   *   PRAISE      - 👏 Celebrate / Support
   *   EMPATHY     - ❤️ Love
   *   INTEREST    - 💡 Insightful / Interesting
   *   APPRECIATION - 🙌 Support (hands)
   *   ENTERTAINMENT - 😂 Funny
   */
  async reactToPost(
    postIdOrUrl: string,
    reactionType: 'LIKE' | 'PRAISE' | 'EMPATHY' | 'INTEREST' | 'APPRECIATION' | 'ENTERTAINMENT' = 'LIKE'
  ): Promise<{ success: boolean; error?: string }> {
    await this.ensureInit();
    await this.mutationJitter();

    try {
      const threadUrn = await this.resolveThreadUrn(postIdOrUrl);

      const queryId = QUERY_IDS.reactions;
      const url = `${VOYAGER_API_BASE}/graphql?action=execute&queryId=${queryId}`;

      const body = {
        variables: {
          entity: { reactionType },
          threadUrn,
        },
        queryId,
        includeWebMetadata: true,
      };

      const res = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { success: false, error: `HTTP ${res.status}: ${errText.substring(0, 200)}` };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Posting ──────────────────────────────────────────────

  /**
   * Create a new text post on LinkedIn.
   *
   * Uses the contentcreation/normShares endpoint (confirmed working 2026-03-31).
   * Posts are public by default. Set connectionsOnly=true for connections-only visibility.
   */
  async createPost(
    text: string,
    options?: { connectionsOnly?: boolean }
  ): Promise<{ success: boolean; postUrl?: string; activityUrn?: string; error?: string }> {
    await this.ensureInit();
    await this.mutationJitter();

    try {
      const body = {
        visibleToConnectionsOnly: options?.connectionsOnly ?? false,
        externalAudienceProviders: [],
        commentaryV2: {
          text,
          attributes: [],
        },
        origin: 'FEED',
        allowedCommentersScope: 'ALL',
        showPremiumAnalytics: false,
      };

      const url = `${VOYAGER_API_BASE}/contentcreation/normShares`;
      const res = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { success: false, error: `HTTP ${res.status}: ${errText.substring(0, 200)}` };
      }

      const result = await res.json().catch(() => ({})) as any;
      const shareUrn = result?.data?.status?.urn || '';
      const toastUrl = result?.data?.status?.toastCtaUrl || '';
      const activityUrn = result?.included?.find(
        (i: any) => i.entityUrn?.includes('fs_updateV2')
      )?.entityUrn?.match(/urn:li:activity:\d+/)?.[0] || '';

      return {
        success: true,
        postUrl: toastUrl || (shareUrn ? `https://www.linkedin.com/feed/update/${shareUrn}` : ''),
        activityUrn,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
