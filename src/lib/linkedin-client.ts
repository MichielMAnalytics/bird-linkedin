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
   * Uses GraphQL with voyagerIdentityDashProfiles queryId.
   */
  async getProfile(publicId: string): Promise<ProfileData | null> {
    const handle = normalizeHandle(publicId);

    // Try GraphQL vanity name lookup
    try {
      const data = await this.graphqlGet(
        `(vanityName:${handle})`,
        QUERY_IDS.profileByVanityName,
        true
      );
      const profile = parseProfileFromGraphQL(data);
      if (profile) return profile;
    } catch {
      // Fall through to memberIdentity-based lookup
    }

    // Fallback: dash/profiles REST endpoint
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
   * Scrapes people search results HTML page.
   */
  async searchPeople(keywords: string, count = 10): Promise<ProfileData[]> {
    const encodedKeywords = encodeURIComponent(keywords);

    // Fetch search results HTML page
    const searchUrl = `${LINKEDIN_BASE}/search/results/people/?keywords=${encodedKeywords}&origin=GLOBAL_SEARCH_HEADER`;

    const html = await this.pageGet(searchUrl);

    // Extract public identifiers from the HTML
    const handles = [...new Set(
      (html.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/g) || [])
        .map(m => m.replace('linkedin.com/in/', ''))
        .filter(h => h.length > 2 && h !== 'me')
    )];

    const profiles: ProfileData[] = [];
    for (const handle of handles.slice(0, count)) {
      try {
        const profile = await this.getProfile(handle);
        if (profile) profiles.push(profile);
      } catch {
        // Skip failed lookups
      }
    }

    return profiles;
  }

  // ── Posting (stubbed - not active yet) ───────────────────

  /**
   * Create a new post (NOT YET ACTIVE - for future use)
   */
  async createPost(_text: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Posting is not yet implemented. Use --dry-run to preview.' };
  }

  /**
   * Reply to a post (NOT YET ACTIVE - for future use)
   */
  async replyToPost(_postId: string, _text: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Replying is not yet implemented. Use --dry-run to preview.' };
  }
}
