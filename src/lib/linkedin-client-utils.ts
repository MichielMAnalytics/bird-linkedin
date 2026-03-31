/**
 * Utilities for parsing LinkedIn Voyager API responses.
 * LinkedIn uses a normalized data model where `included` contains all entities
 * and they reference each other via entityUrn.
 */

export interface PostData {
  id: string;               // activity ID
  urn: string;              // full URN
  text: string;             // post text
  authorName: string;
  authorHandle: string;     // publicIdentifier
  authorUrn: string;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  repostCount: number;
  url: string;
  media: MediaItem[];
  article?: ArticleData;
}

export interface ArticleData {
  title: string;
  subtitle?: string;
  url?: string;
}

export interface MediaItem {
  type: 'image' | 'video' | 'document';
  url?: string;
}

export interface CommentData {
  id: string;
  text: string;
  authorName: string;
  authorHandle: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
}

export interface ProfileData {
  id: string;
  firstName: string;
  lastName: string;
  headline: string;
  publicIdentifier: string;
  entityUrn: string;
  location?: string;
  connectionsCount?: number;
  followersCount?: number;
}

export interface SearchResult {
  posts: PostData[];
  cursor?: string;
}

/**
 * Extract the activity ID from a URN like urn:li:activity:1234567890
 */
export function extractActivityId(urn: string): string {
  const match = urn.match(/urn:li:activity:(\d+)/);
  return match ? match[1] : urn;
}

/**
 * Extract activity ID from a LinkedIn URL or plain ID
 */
export function parsePostId(input: string): string {
  // URL like https://www.linkedin.com/feed/update/urn:li:activity:1234/
  const urlMatch = input.match(/urn:li:activity:(\d+)/);
  if (urlMatch) return urlMatch[1];

  // URL like https://www.linkedin.com/posts/username_title-activity-1234-xxxx
  const postsMatch = input.match(/activity-(\d+)/);
  if (postsMatch) return postsMatch[1];

  // Plain ID
  if (/^\d+$/.test(input)) return input;

  return input;
}

/**
 * Build the activity URN from an ID
 */
export function activityUrn(id: string): string {
  return `urn:li:activity:${id}`;
}

/**
 * Parse a normalized Voyager API response into post data.
 * The response has { data, included } where included contains all entities.
 */
export function parsePostsFromIncluded(included: any[]): PostData[] {
  if (!included || !Array.isArray(included)) return [];

  // Find all UpdateV2 entities (rendered posts)
  const updates = included.filter(
    (i) => i['$type'] === 'com.linkedin.voyager.feed.render.UpdateV2'
  );

  // Build lookup maps
  const profileMap = new Map<string, any>();
  const socialCountsMap = new Map<string, any>();

  for (const item of included) {
    if (item['$type'] === 'com.linkedin.voyager.identity.shared.MiniProfile') {
      profileMap.set(item.entityUrn, item);
    }
    if (item['$type'] === 'com.linkedin.voyager.feed.shared.SocialActivityCounts') {
      socialCountsMap.set(item.entityUrn, item);
    }
  }

  const posts: PostData[] = [];

  for (const update of updates) {
    const post = parseUpdateV2(update, profileMap, socialCountsMap);
    if (post) posts.push(post);
  }

  return posts;
}

function parseUpdateV2(
  update: any,
  profileMap: Map<string, any>,
  socialCountsMap: Map<string, any>
): PostData | null {
  try {
    // Extract activity ID from entityUrn
    const urn = update.entityUrn || '';
    const activityMatch = urn.match(/urn:li:activity:(\d+)/);
    const id = activityMatch ? activityMatch[1] : '';

    if (!id) return null;

    // Get post text from commentary
    const text = update.commentary?.text?.text || '';

    // Get author info from actor
    const actorName = update.actor?.name?.text || '';
    const actorHandle = update.actor?.navigationContext?.actionTarget?.match(
      /linkedin\.com\/in\/([^/?]+)/
    )?.[1] || '';
    const actorUrn = update.actor?.urn || '';

    // Get social counts
    const socialDetailUrn = update['*socialDetail'] || '';
    const countsUrn = socialDetailUrn.replace('fs_socialDetail', 'fs_socialActivityCounts');
    const counts = socialCountsMap.get(countsUrn) ||
      // Try to find counts by matching activity URN
      findCountsForActivity(id, socialCountsMap);

    const likeCount = counts?.numLikes ?? 0;
    const commentCount = counts?.numComments ?? 0;
    const repostCount = counts?.numShares ?? 0;

    // Get media
    const media = parseMedia(update);

    // Get article
    const article = parseArticle(update);

    // Get creation time (from actor subDescription which often has "Xd" or timestamp)
    const createdAt = update.actor?.subDescription?.text || '';

    const url = `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`;

    return {
      id,
      urn: `urn:li:activity:${id}`,
      text,
      authorName: actorName,
      authorHandle: actorHandle,
      authorUrn: actorUrn,
      createdAt,
      likeCount,
      commentCount,
      repostCount,
      url,
      media,
      article,
    };
  } catch {
    return null;
  }
}

function findCountsForActivity(activityId: string, countsMap: Map<string, any>): any {
  for (const [urn, counts] of countsMap) {
    if (urn.includes(activityId)) return counts;
  }
  return null;
}

function parseMedia(update: any): MediaItem[] {
  const media: MediaItem[] = [];

  // Image content
  if (update.content?.images) {
    for (const img of update.content.images) {
      media.push({ type: 'image', url: img.attributes?.[0]?.vectorImage?.rootUrl });
    }
  }

  // Carousel / grid content
  if (update.gridContent?.images) {
    for (const img of update.gridContent.images) {
      media.push({ type: 'image' });
    }
  }

  // Video content
  if (update.content?.['com.linkedin.voyager.feed.render.LinkedInVideoComponent']) {
    media.push({ type: 'video' });
  }

  // Document content
  if (update.content?.['com.linkedin.voyager.feed.render.DocumentComponent']) {
    media.push({ type: 'document' });
  }

  return media;
}

function parseArticle(update: any): ArticleData | undefined {
  const article = update.content?.navigationContext;
  if (!article) return undefined;

  const miniArticle = update.content;
  return {
    title: miniArticle?.title?.text || '',
    subtitle: miniArticle?.subtitle?.text,
    url: article?.actionTarget,
  };
}

/**
 * Parse comments from included data
 */
export function parseCommentsFromIncluded(included: any[]): CommentData[] {
  if (!included || !Array.isArray(included)) return [];

  const comments = included.filter(
    (i) => i['$type'] === 'com.linkedin.voyager.feed.Comment'
  );

  // Build profile lookup by entityUrn
  const profileMap = new Map<string, any>();
  for (const item of included) {
    if (item['$type'] === 'com.linkedin.voyager.identity.shared.MiniProfile') {
      profileMap.set(item.entityUrn, item);
    }
  }

  return comments.map((c) => {
    // commenter has '*miniProfile' which is a reference to a MiniProfile entityUrn
    const miniProfileUrn = c.commenter?.['*miniProfile'] || '';
    const profile = profileMap.get(miniProfileUrn);

    // Get comment text - different formats
    const text = c.comment?.values?.[0]?.value ||
      c.commentV2?.text ||
      c.commentary?.text?.text ||
      '';

    return {
      id: c.entityUrn || '',
      text,
      authorName: profile ? `${profile.firstName} ${profile.lastName}` : 'Unknown',
      authorHandle: profile?.publicIdentifier || '',
      createdAt: c.createdTime ? new Date(c.createdTime).toISOString() : '',
      likeCount: c.socialDetail?.totalSocialActivityCounts?.numLikes ?? 0,
      replyCount: c.socialDetail?.totalSocialActivityCounts?.numComments ?? 0,
    };
  }).filter(c => c.text); // only include comments with text
}

/**
 * Parse profile data from GraphQL response
 */
export function parseProfileFromGraphQL(data: any): ProfileData | null {
  try {
    const profiles = data.data?.identityDashProfilesByMemberIdentity?.elements;
    if (!profiles || profiles.length === 0) return null;

    const p = profiles[0];
    return {
      id: p.entityUrn || '',
      firstName: p.firstName || '',
      lastName: p.lastName || '',
      headline: p.headline || '',
      publicIdentifier: p.publicIdentifier || '',
      entityUrn: p.entityUrn || '',
      location: p.geoLocation?.geo?.defaultLocalizedName,
    };
  } catch {
    return null;
  }
}

/**
 * Parse profile from dash/profiles response
 */
export function parseProfileFromDash(included: any[]): ProfileData | null {
  if (!included) return null;

  const profile = included.find((i) =>
    i['$type']?.includes('MiniProfile') || i.publicIdentifier
  );

  if (!profile) return null;

  return {
    id: profile.entityUrn || '',
    firstName: profile.firstName || '',
    lastName: profile.lastName || '',
    headline: profile.occupation || profile.headline || '',
    publicIdentifier: profile.publicIdentifier || '',
    entityUrn: profile.entityUrn || '',
  };
}

/**
 * Normalize a LinkedIn handle (remove leading @, trim, lowercase)
 */
export function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, '').trim().toLowerCase();
}
