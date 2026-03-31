# bird-linkedin — Progress & Roadmap

## Current State (2026-03-31)

CLI is functional for reading, searching, commenting, and reacting. LinkedIn's migration to SDUI (React Server Components) has broken or limited several write operations and profile data access.

## What Works

| Command | Status | Notes |
|---------|--------|-------|
| `whoami` | **Solid** | REST `/me` endpoint, reliable |
| `check` | **Solid** | Same as whoami |
| `home` | **Working** | Legacy `chronFeed` REST endpoint |
| `user-posts` | **Partial** | Legacy REST works for some, HTML scraping fallback often returns 0 (SDUI) |
| `read` | **Solid** | By ID or full URL |
| `comments` | **Working** | Returns comments embedded in feed response, may truncate long threads |
| `search` (posts) | **Working** | HTML scraping, ~10 results per page, no pagination |
| `search-people` | **Working** | Parses SDUI HTML cards, gets name/headline/location. ~10 per page |
| `about` | **Degraded** | Name only. No headline/company/bio (SDUI killed the API) |
| `reply` | **Solid** | `voyagerSocialDashNormComments` endpoint confirmed working |
| `react` | **Solid** | `voyagerSocialDashReactions` GraphQL mutation, all 6 types |
| `post` | **Stub** | Not implemented — needs SDUI reverse engineering or alternative |

## Anti-Detection Stack

- [x] Full Chrome 146 header fidelity (sec-ch-ua, sec-fetch-*, priority, x-li-track)
- [x] Runtime `clientVersion` scraping from LinkedIn frontend JS
- [x] Authenticated cookie jar (~25 cookies, persisted, refreshed per response)
- [x] Persistent session identity (UUID, pageInstanceId, display resolution)
- [x] Manual redirect following with Set-Cookie capture
- [x] Session invalidation detection (`li_at=delete me`)
- [x] Mutation jitter (2-5s random delay on writes)
- [ ] Rate limiter (no built-in rate limiting yet)
- [ ] Cookie TTL-aware refresh (Cloudflare `__cf_bm` expires ~30min)
- [ ] User-Agent rotation per session

## What's Broken / Blocked by LinkedIn's SDUI Migration

LinkedIn has been migrating from Voyager REST/GraphQL APIs to a new "SDUI" architecture (React Server Components served via `flagship-web/rsc-action/`). Write operations and profile data are increasingly behind this opaque protocol.

### Profile data (`about` command)
- **Problem**: Profile pages are fully SDUI-rendered. The old Voyager GraphQL vanity name lookup returns 400. The REST `dash/profiles` endpoint returns 400 for vanity names.
- **Current workaround**: Scrape `<title>` from profile HTML page. Gets name only.
- **Fix options**:
  1. Parse the RSC payload from the profile page (structured data is in there, just serialized)
  2. Use search-people results which DO include headlines
  3. Capture the SDUI `profileTopCardSection` RSC response and extract structured fields

### Create post (`post` command)
- **Problem**: Post creation likely goes through SDUI encrypted endpoints (same as connect).
- **Status**: Not attempted yet. Need to intercept network traffic while creating a post.
- **Fix options**:
  1. Intercept the actual API call from Chrome DevTools (like we did for comments/reactions)
  2. There may still be a Voyager endpoint for UGC post creation (`/voyagerContentCreationDash*`)
  3. Browser automation fallback

### Send connection request (`connect` command)
- **Problem**: Confirmed blocked. The old `growth/normInvitations` returns 301 (deprecated). The actual invite goes through PerimeterX-encrypted binary payloads.
- **Fix options**:
  1. Browser automation (navigate to profile, click Connect, click Send)
  2. Monitor if LinkedIn re-exposes a REST endpoint in future API versions

### Pagination
- **Problem**: `search`, `search-people`, `home`, and `user-posts` are limited to one page of results.
- **Fix options**:
  1. For `home`: the REST endpoint supports `start` param — just wire it up
  2. For search: scrape page 2+ by adding `&page=2` to the URL
  3. For `user-posts`: need a working paginated endpoint

## Roadmap — Priority Order

### P0 — High Impact, Likely Feasible
1. **Create post** — Intercept the network call when posting from Chrome. If it's a clean Voyager endpoint (like comments/reactions were), implement it. If it's SDUI-encrypted, document and skip.
2. **Pagination for `home`** — The `chronFeed` endpoint already supports `start` param. Add `--page` or `--start` flag.
3. **Rate limiter** — Add configurable rate limiting (e.g., max N requests per minute) to prevent detection during heavy use.

### P1 — Medium Impact
4. **Richer profile data** — Parse RSC payload from profile pages to extract headline, company, location, bio, experience. The data is there, just needs a deserializer.
5. **Pagination for `search` and `search-people`** — Add `&page=N` to search URLs and aggregate results.
6. **Delete comment** — Find the endpoint for removing own comments.
7. **Remove reaction** — Toggle reaction off (likely same endpoint with a different action).
8. **Like/react to comments** — Reactions on comments, not just posts.

### P2 — Nice to Have
9. **User-posts via GraphQL** — Find the current recipe for user activity feeds (the REST endpoint is deprecated for some profiles).
10. **Contact info command** — Scrape `/overlay/contact-info/` page for connections.
11. **Messaging** — The `voyagerMessagingGraphQL` endpoint works (we saw mailbox counts). Could add read/send DMs.
12. **Notifications** — Read notification feed.
13. **Cookie TTL-aware refresh** — Track when `__cf_bm` and `_px3` expire and proactively refresh.
14. **Browser automation fallback** — For operations that are SDUI-only, offer a `--browser` flag that automates Chrome.

### P3 — Long Term
15. **Connection management** — List connections, pending invitations.
16. **Company pages** — Fetch company info, employee lists, job posts.
17. **Analytics** — Post impression/engagement data (if accessible via API).
18. **Scheduled posting** — Queue posts for later (local scheduler).
19. **MCP server** — Expose bird-linkedin as an MCP tool server so AI agents can use it directly.

## API Endpoints Reference

### Confirmed Working (2026-03-31)
| Endpoint | Method | Use |
|----------|--------|-----|
| `/voyager/api/me` | GET | Current user identity |
| `/voyager/api/feed/updates?q=chronFeed` | GET | Home feed |
| `/voyager/api/feed/updates/{urn}` | GET | Post detail + comments |
| `/voyager/api/feed/updates?q=memberShareFeed` | GET | User posts (works for some profiles) |
| `/voyager/api/voyagerSocialDashNormComments` | POST | Create comment |
| `/voyager/api/graphql?action=execute` | POST | Reactions (via queryId) |
| `/voyager/api/graphql?includeWebMetadata=true` | GET | Various GraphQL reads |

### Deprecated / Broken
| Endpoint | Status | Notes |
|----------|--------|-------|
| `/voyager/api/growth/normInvitations` | 301 | Connection invites — moved, no redirect target |
| `/voyager/api/identity/profiles/{handle}/profileContactInfo` | 410 | Gone |
| `/voyager/api/identity/profiles/{handle}/networkinfo` | 410 | Gone |
| `/voyager/api/identity/profiles/{handle}/profileView` | 410 | Gone |
| `/voyager/api/search/blended` | 404 | Old search — removed |
| `/voyager/api/feed/normComments` | 404 | Old comments — use `voyagerSocialDashNormComments` |

### Untested / To Investigate
| Endpoint | Potential Use |
|----------|--------------|
| `/voyager/api/voyagerContentCreationDash*` | Post creation |
| `/voyager/api/voyagerMessagingGraphQL/graphql` | Read/send DMs |
| `/voyager/api/voyagerNotificationsDash*` | Notifications |
| `/voyager/api/voyagerRelationshipsDashConnections` | Connection list |

## Session & Config Files

| File | Purpose |
|------|---------|
| `~/.config/bird-linkedin/session.json` | Persistent UUID, pageInstanceId, display resolution, memberIdentity, clientVersion |
| `~/.config/bird-linkedin/cookies.json` | Full cookie jar (~25 cookies), refreshed per response |
| `.env` | `LI_AT` and `JSESSIONID` credentials |
