# Raycast Soulseek Extension

A Raycast extension for searching and downloading music from Soulseek via the slskd daemon. Built for personal use + easy sharing with non-technical friends.

## Quick orientation

Three Raycast commands:
- **Search Soulseek** (`src/search.tsx`) — search + download with live progress toast
- **View Downloads** (`src/downloads.tsx`) — active/completed transfers with auto-refresh
- **Setup Soulseek** (`src/setup.tsx`) — installs slskd, or connects to an existing instance

All API calls go through `src/api/slskd.ts`. Sorting/formatting helpers live in `src/utils/quality.ts`.

## Dev workflow

```bash
npm install       # first time only
npm run dev       # starts Raycast dev mode — extension reloads on save
npx tsc --noEmit  # typecheck without building
```

Extension runs in Raycast's dev mode. No separate build step needed during development. `npm run build` produces a dist/ for publishing to the Raycast store (not needed for personal use).

## User's local slskd setup

The user already has slskd running independently (not installed by this extension):
- Binary: `~/slskd/app/slskd`
- Data dir: `~/slskd/data/`
- Config: `~/slskd/data/slskd.yml`
- Downloads: `~/slskd/downloads/`
- API key: stored in Raycast LocalStorage (`slskd_api_key`), set via the Setup command's "Enter API Key" screen
- URL: `http://127.0.0.1:5030` (must be IPv4 — `localhost` resolves to `::1` in Node.js/Raycast but slskd's CIDR only allows `127.0.0.1/32`)

## Sharing with non-technical friends

`bootstrap.sh` in the project root is a one-liner installer:
1. Checks Raycast is installed (opens raycast.com if not)
2. Installs Homebrew + Node if missing
3. Clones the repo, runs `npm install`, starts `npm run dev`
4. Opens Raycast to the Setup Soulseek command

The Setup command then downloads slskd (~100 MB), writes config, creates a LaunchAgent for auto-start, and saves the API key to LocalStorage. Friends only need to paste one `curl | bash` command and fill in their Soulseek credentials.

Update the `REPO=` line in `bootstrap.sh` when you push to GitHub.

## Preferences (package.json)

| Name | Type | Default |
|---|---|---|
| `slskdUrl` | textfield | `http://127.0.0.1:5030` |
| `apiKey` | password | — (set by Setup) |
| `formatPreference` | textfield | `FLAC, MP3, AAC, OGG, M4A, WMA` |
| `bestQuality` | checkbox | false |
| `excludeFlac` | checkbox | false |

## slskd API quirks (hard-won)

**State strings are compound flags** — slskd serializes enum flags as comma-separated strings: `"Completed, ResponseLimitReached"`, `"Completed, TimedOut"`. Never use `=== "Completed"` — use `.includes("Completed")`. Same for transfer states: `"Completed, Succeeded"` is a done download. `normalizeTransferState()` in `slskd.ts` handles this for transfers.

**Download response shape** — `GET /api/v0/transfers/downloads` returns:
```
[{ username, directories: [{ files: [Transfer] }] }]
```
Not a flat array. `listDownloads()` flattens this.

**IPv4 vs IPv6** — Always use `http://127.0.0.1:5030`, never `http://localhost:5030`. Node.js resolves `localhost` → `::1` but slskd's default CIDR is `127.0.0.1/32`.

**Gatekeeper quarantine** — Downloaded slskd binary needs `xattr -d com.apple.quarantine` before it will run.

**wwwroot required** — `unzip` must extract the full ZIP (not just the binary) — slskd fails to start without the `wwwroot/` directory.

**Search completion** — Poll `GET /api/v0/searches/{id}` until `state.includes("Completed")`. The `/responses` endpoint returns whatever has accumulated so far on each call. Search ends at `responseLimit` (100) or `searchTimeout` (5000ms), whichever comes first.

**isLoading blocks Raycast list items** — When `<List isLoading={true}>`, Raycast doesn't render `List.Item` children until isLoading is false. Keep `isLoading` tied to a state where you genuinely want to block rendering, not just "something is happening in the background."

## Architecture pattern (reusable for other extensions)

This extension follows a clean three-layer pattern that works well for any service with a REST API:

```
src/
  api/<service>.ts     ← all fetch() calls, auth headers, response normalization
  utils/<domain>.ts    ← pure functions: sorting, formatting, helpers
  <command>.tsx        ← Raycast UI: state, polling, actions
```

**LocalStorage for runtime config** — Preferences set at install time go in `LocalStorage` (not just Raycast prefs) so the Setup command can write them programmatically. `getConfig()` in `slskd.ts` reads LocalStorage first, falls back to Raycast prefs, then hardcoded defaults.

**Polling pattern** — For async operations (searches, long downloads):
```typescript
const interval = setInterval(async () => {
  const data = await fetchStatus(id);
  setState(data);
  if (isTerminal(data)) clearInterval(interval);
}, 500);
// clean up in useEffect return
return () => clearInterval(interval);
```

**Toast progress** — `showToast()` returns a mutable toast object. Mutate `.message`, `.style`, `.title` in place to update it live without creating new toasts.

## Repurposing for other projects (e.g. Ableton)

To adapt this pattern for a different backend (Ableton Live's REST API, any local daemon, etc.):

1. Replace `src/api/slskd.ts` with a client for the new service
2. Keep or adapt `src/utils/quality.ts` for domain-specific sorting/formatting
3. Replace command files with new Raycast views
4. Update `package.json` manifest (name, commands, preferences)
5. Update `bootstrap.sh` repo URL and any setup steps

Ableton has a REST API via the `python-live` bridge or AbletonOSC — similar pattern would work: poll for state, trigger actions via POST, display results in a List.

The `setup.tsx` installer pattern (detect → configure → install binary → LaunchAgent → poll until ready) is generic and reusable for any macOS daemon you want to bundle with a Raycast extension.
