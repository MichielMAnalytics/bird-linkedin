/**
 * Constants for the LinkedIn Voyager API client.
 * Centralized so header values, endpoints, and query IDs can be updated in one place.
 *
 * All values are derived from real Chrome DevTools network captures.
 */

// ── API Endpoints ──────────────────────────────────────────────────────

export const LINKEDIN_BASE = 'https://www.linkedin.com';
export const VOYAGER_API_BASE = `${LINKEDIN_BASE}/voyager/api`;
export const GRAPHQL_ENDPOINT = `${VOYAGER_API_BASE}/graphql`;

// ── Client Version ─────────────────────────────────────────────────────
// This is the version LinkedIn's frontend JS reports via x-li-track.
// Updated from live capture; will be overridden at runtime if we can scrape it.

export const CLIENT_VERSION = '1.13.43122.3';

// ── Browser Identity ───────────────────────────────────────────────────

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

export const SEC_CH_UA =
  '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"';

export const SEC_CH_UA_MOBILE = '?0';
export const SEC_CH_UA_PLATFORM = '"macOS"';

// ── Accept Headers ─────────────────────────────────────────────────────

export const ACCEPT_GRAPHQL = 'application/graphql';
export const ACCEPT_REST = 'application/vnd.linkedin.normalized+json+2.1';
export const ACCEPT_HTML =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
export const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';
export const ACCEPT_ENCODING = 'gzip, deflate, br, zstd';

// ── Common Display Resolutions ─────────────────────────────────────────
// Randomly selected per session to avoid fingerprinting.

export const COMMON_RESOLUTIONS: Array<{ width: number; height: number; density: number }> = [
  { width: 3024, height: 1964, density: 2 },  // MacBook Pro 14"
  { width: 3456, height: 2234, density: 2 },  // MacBook Pro 16"
  { width: 2560, height: 1440, density: 2 },  // iMac 27" / 5K
  { width: 1920, height: 1080, density: 1 },  // Generic Full HD
  { width: 2560, height: 1600, density: 2 },  // MacBook Air 13"
  { width: 1728, height: 1117, density: 2 },  // MacBook Air 15"
  { width: 1512, height: 982, density: 2 },   // MacBook Pro 14" (scaled)
  { width: 1440, height: 900, density: 2 },   // MacBook Pro 13"
];

// ── Known GraphQL Query IDs ────────────────────────────────────────────
// Format: recipeName.hash
// Captured from LinkedIn's voyager-web frontend JS.

export const QUERY_IDS: Record<string, string> = {
  // Profile
  profileByVanityName:
    'voyagerIdentityDashProfiles.34ead06db82a2cc9a778fac97f69ad6a',
  profileByMemberIdentity:
    'voyagerIdentityDashProfiles.b5c27c04968c409fc0ed3546575b9b7a',

  // Feed
  feedHome:
    'voyagerFeedDashRelevanceFeedByHomeV2.ab5aaa484dd22cddfbef9ce0bc85c898',

  // Search
  searchClusters:
    'voyagerSearchDashClusters.66cf0ac690f3659341bb30e8e68ee1db',

  // Settings
  mySettings:
    'voyagerDashMySettings.7ea6de345b41dfb57b660a9a4bebe1b8',

  // Messaging
  messengerMailboxCounts:
    'messengerMailboxCounts.fc528a5a81a76dff212a4a3d2d48e84b',

  // Premium
  premiumUpsellSlot:
    'voyagerPremiumDashUpsellSlotContent.297ce76758cb2c07c82b30c1da9e97dc',
};

// ── Defaults ───────────────────────────────────────────────────────────

export const DEFAULT_POST_COUNT = 10;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_REDIRECTS = 5;
