# bird-linkedin

A full-featured LinkedIn CLI built on the undocumented Voyager API with cookie-based auth. Read feeds, search posts/people, view profiles, and more — all from your terminal.

## How it works

LinkedIn's web app communicates with a private REST + GraphQL API (`/voyager/api/`). This CLI replicates exactly what Chrome sends — same headers, cookies, telemetry, and request patterns — so LinkedIn sees it as a normal browser session.

Key anti-detection measures:
- **Full browser header fidelity** — `sec-ch-ua`, `sec-fetch-*`, `x-li-track`, `x-li-page-instance`, `priority`, and all other headers Chrome 146 sends
- **Runtime version discovery** — scrapes LinkedIn's current `clientVersion` from the frontend JS on every init, so the telemetry never goes stale
- **Authenticated cookie jar** — collects the full ~25 cookie set from linkedin.com (including Cloudflare, PerimeterX, and tracking cookies), persists to disk, and refreshes from every API response
- **Persistent session identity** — stable UUID, page instance ID, and display resolution across runs
- **Manual redirect following** — captures `Set-Cookie` headers on every 302 hop
- **Session invalidation detection** — catches `li_at=delete me` and gives a clear error

## Quick start (for AI agents)

If you're an AI agent and need to interact with LinkedIn, follow these steps:

```bash
# 1. Clone and build
git clone https://github.com/MichielMAnalytics/bird-linkedin.git ~/bird-linkedin
cd ~/bird-linkedin
npm install && npm run build

# 2. Ask the user for their LinkedIn credentials (li_at and JSESSIONID)
#    They can find these at: linkedin.com > DevTools (F12) > Application > Cookies > https://www.linkedin.com
export LI_AT=<paste_li_at>
export JSESSIONID=<paste_jsessionid>

# 3. Verify it works
node ~/bird-linkedin/dist/cli.js whoami
```

Once `whoami` returns the user's profile, you're ready. Use the commands below to read, search, and browse.

## Install

```bash
git clone https://github.com/MichielMAnalytics/bird-linkedin.git
cd bird-linkedin
npm install
npm run build

# Or link globally
npm link
```

## Authentication

bird-linkedin uses cookie-based auth. You need two values from your browser:

1. Open [linkedin.com](https://www.linkedin.com) and log in
2. Open DevTools (F12) > Application > Cookies > `https://www.linkedin.com`
3. Copy the values of `li_at` and `JSESSIONID`

Then either export them as env vars:

```bash
export LI_AT=your_li_at_cookie_here
export JSESSIONID="ajax:your_jsessionid_here"
```

Or pass them as CLI flags:

```bash
bird-linkedin --li-at YOUR_LI_AT --jsessionid YOUR_JSESSIONID whoami
```

Or create a `.env` file in the project root:

```bash
LI_AT=your_li_at_cookie_here
JSESSIONID="ajax:your_jsessionid_here"
```

The credentials are not IP-bound — they work from any machine.

## Usage

```bash
# Check auth
bird-linkedin whoami
bird-linkedin check

# Read posts
bird-linkedin read 7444707203896246273
bird-linkedin read https://www.linkedin.com/feed/update/urn:li:activity:7444707203896246273/
bird-linkedin comments 7444707203896246273

# Home feed
bird-linkedin home
bird-linkedin home --count 20

# User posts
bird-linkedin user-posts michiel-voortman
bird-linkedin user-posts michiel-voortman --count 5

# Search
bird-linkedin search "AI agents"
bird-linkedin search-people "software engineer"

# Profiles
bird-linkedin about michiel-voortman
```

### Global flags

| Flag | Description |
|---|---|
| `--json` | Output raw JSON |
| `--li-at <token>` | li_at cookie (or use `LI_AT` env var) |
| `--jsessionid <token>` | JSESSIONID cookie (or use `JSESSIONID` env var) |
| `--timeout <ms>` | Request timeout |
| `--verbose` | Verbose output |

### Pagination

`home`, `user-posts`, `search`, and `search-people` support `--count <n>` to control the number of results.

## Architecture

```
src/
  cli.ts                          # Entry point
  cli/                            # CLI framework (Commander.js)
  commands/                       # Subcommand handlers
  lib/
    linkedin-client.ts            # Full client with all API methods
    linkedin-client-base.ts       # Auth, headers, fetch, anti-detection
    linkedin-client-constants.ts  # URLs, version, headers, query IDs
    linkedin-client-utils.ts      # Response parsing (posts, profiles, comments)
    cookie-jar.ts                 # Cookie collection, persistence, and merging
    session-store.ts              # Persistent session identity
    cookies.ts                    # Credential resolution (env vars / flags)
    output.ts                     # Terminal formatting
    index.ts                      # Public API exports
```

### Endpoint strategy

LinkedIn's frontend uses two API styles:

- **GraphQL**: `GET /voyager/api/graphql?variables=(key:value)&queryId=recipeName.hash`
- **REST**: `GET /voyager/api/...` (some legacy endpoints still work)

The client tries GraphQL first and falls back to REST. For search, it scrapes the HTML results page (more stealthy than API search).

### Anti-detection architecture

Modeled after [bird-rebuilt](https://github.com/MichielMAnalytics/bird-rebuilt) (our Twitter/X CLI):

1. **Init sequence** — On first request: load persistent session, collect authenticated cookies from linkedin.com homepage (following all redirects), scrape current `clientVersion` from frontend JS
2. **Header fidelity** — Every request includes the exact headers Chrome sends, including `x-li-track` telemetry, `sec-ch-*` client hints, and `priority`
3. **Cookie jar** — Persists ~25 cookies to `~/.config/bird-linkedin/cookies.json`, refreshes from every API response (keeps Cloudflare `__cf_bm`, PerimeterX `_px3`, etc. fresh)
4. **Session persistence** — `~/.config/bird-linkedin/session.json` stores stable UUIDs, display resolution, and scraped version across runs
5. **Mutation jitter** — Random 2-5 second delay before POST/PUT operations

## Dependencies

Two runtime dependencies:

- `commander` — CLI framework
- `kleur` — Terminal colors

Zero native/binary dependencies. Runs anywhere Node.js 18+ runs.

## License

MIT
