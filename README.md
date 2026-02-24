# when-there

Time zone comparison app for planning across cities.

## Current behavior

### Default startup (first visit)

- Slot 1: viewer city from IP (Vercel headers), normalized with Geoapify reverse geocoding when available
- Slot 2: Portland, Oregon
- Slot 3: Bangkok, Thailand

### Hour format (12h / 24h)

- Uses IP country (Vercel header) to choose format
- Europe -> `24h`
- Americas/default -> `12h` (`AM/PM`)
- Browser timezone/locale is used only as a fallback when the server endpoint is unavailable (for example local static dev)

### Shared links (`?state=...`)

- Shared links encode the exact app state:
  - zone list (order + labels + timezones)
  - selected reference hour
- On load, shared URL state has priority over local preferences/defaults
- Opening a shared link does not get overridden by localStorage on initial render

### Local persistence (after user interaction)

After user interaction, local storage is updated so the app restores their preferences on future visits.

- Full local app state (`zones + selected hour`) is persisted when user:
  - clicks an hour row
  - adds/edits a zone
  - removes a zone
  - reorders zones
- If full local app state exists, defaults are not re-inserted

### Precedence order on load

1. Shared URL state (`?state=...`)
2. Full local app state (`zones + selected`)
3. Legacy local zone preferences (`zones only`)
4. Legacy first-city local override
5. IP/default seeding (viewer city, Portland, Bangkok)

## Dev notes

- Local static server (`python3 -m http.server`) will not serve `/api/*` endpoints, so IP-based logic falls back to browser heuristics.
- On Vercel, `/api/viewer-hour-format` reads IP headers and can enrich the viewer city using Geoapify (`GEOAPIFY` env var).
