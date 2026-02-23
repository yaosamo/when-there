const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const HOUR_MS = 60 * 60 * 1000;
const CASCADE_DELAY_MS = 50;

const DEFAULT_ZONES = [
  { timeZone: "America/Los_Angeles", title: "Portland", subtitle: "United States, OR" },
  { timeZone: "America/Edmonton", title: "Calgary", subtitle: "Canada, AB" },
  { timeZone: "America/Chicago", title: "Houston", subtitle: "United States, TX" },
  { timeZone: "America/New_York", title: "Miami", subtitle: "United States, FL" },
  { timeZone: "Europe/Warsaw", title: "Warsaw", subtitle: "Poland" }
];

let nextZoneId = 1;

const state = {
  zones: DEFAULT_ZONES.map((zone) => ensureZoneEntry(zone)),
  selected: null
};

const timelineEl = document.querySelector("#timeline");
const addZoneButton = document.querySelector("#add-zone-button");
const shareStateButton = document.querySelector("#share-state-button");
const addZonePanel = document.querySelector("#add-zone-panel");
const addZoneForm = document.querySelector("#add-zone-form");
const addZoneInput = document.querySelector("#add-zone-input");
const searchResultsEl = document.querySelector("#search-results");
const suggestedZonesEl = document.querySelector("#suggested-zones");
const columnTemplate = document.querySelector("#column-template");
const formatterCache = new Map();
const geoapifyKey = window.APP_CONFIG?.GEOAPIFY_KEY || "";
const quickSuggestions = [
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Warsaw",
  "Asia/Tokyo",
  "Asia/Bangkok",
  "Australia/Sydney"
];
const timezoneValues = getSupportedTimeZones();
let columnViews = [];
let autocompleteTimer = 0;
let autocompleteController = null;
let searchItems = [];
let shareSuccessTimer = 0;
let dragState = null;

bootstrap();

function bootstrap() {
  hydrateStateFromUrl();
  wireEvents();
  startLiveClock();
  render();
}

function wireEvents() {
  addZoneButton.addEventListener("click", () => {
    const willOpen = addZonePanel.hidden;
    addZonePanel.hidden = !willOpen;
    addZoneButton.classList.toggle("is-open", willOpen);
    if (willOpen) {
      renderSuggestedZones();
      hideSearchResults();
      addZoneInput.focus();
      addZoneInput.select();
    }
  });
  shareStateButton.addEventListener("click", () => {
    shareCurrentState();
  });
  addZoneForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addZoneFromInput();
  });
  addZoneInput.addEventListener("input", () => {
    addZoneInput.setCustomValidity("");
    const query = addZoneInput.value.trim();
    renderSuggestedZones(query);
    scheduleAutocompleteSearch(query);
  });
  addZoneInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAddZonePanel();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (addZonePanel.hidden) return;
    const target = event.target;
    if (addZonePanel.contains(target) || addZoneButton.contains(target)) return;
    closeAddZonePanel();
  });
}

function render() {
  timelineEl.innerHTML = "";
  columnViews = [];

  for (const zone of state.zones) {
    const column = columnTemplate.content.firstElementChild.cloneNode(true);
    const titleEl = column.querySelector(".zone-title");
    const subtitleEl = column.querySelector(".zone-subtitle");
    const removeButton = column.querySelector(".remove-zone");
    const hoursEl = column.querySelector(".hours");
    column.dataset.zoneId = zone.id;
    column.draggable = true;
    column.classList.add("is-draggable");

    titleEl.textContent = zone.title;
    subtitleEl.textContent = zone.subtitle;
    removeButton.hidden = state.zones.length <= 1;
    removeButton.addEventListener("click", () => {
      state.zones = state.zones.filter((z) => z.id !== zone.id);
      if (state.selected?.zoneId === zone.id) {
        state.selected = null;
      }
      render();
    });
    wireColumnDragEvents(column, zone);
    const selectionBar = document.createElement("div");
    selectionBar.className = "selection-bar";
    selectionBar.setAttribute("aria-hidden", "true");
    hoursEl.append(selectionBar);
    const rowsByHour = [];

    for (const hour of HOURS) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "hour-row";
      row.setAttribute("role", "listitem");
      row.dataset.timeZone = zone.timeZone;
      row.dataset.zoneId = zone.id;
      row.dataset.hour = String(hour);
      row.innerHTML = `<span>${formatHour(hour)}</span>`;
      row.classList.add(isDayHour(hour) ? "tone-day" : "tone-night");

      row.addEventListener("focus", () => {
        // Focus does not preview selection; click commits selection.
      });

      row.addEventListener("click", () => {
        state.selected = getReferenceFromLocalHour(zone.timeZone, hour, Date.now(), zone.id);
        updateHighlights();
      });

      rowsByHour[hour] = row;
      hoursEl.append(row);
    }

    const liveClock = document.createElement("div");
    liveClock.className = "timezone-meta";
    liveClock.textContent = formatZoneNow(zone.timeZone);
    hoursEl.prepend(liveClock);

    columnViews.push({ zone, column, hoursEl, rowsByHour, liveClock, selectionBar });
    timelineEl.append(column);
  }

  updateHighlights();
}

function getReferenceFromLocalHour(timeZone, localHour, anchorUtcMs = Date.now(), zoneId = null) {
  const offsetHours = getOffsetMinutes(timeZone, anchorUtcMs) / 60;
  const utcHour = localHour - offsetHours;
  return {
    zoneId,
    timeZone,
    localHour,
    utcMs: anchorUtcMs + (utcHour - new Date(anchorUtcMs).getUTCHours()) * HOUR_MS
  };
}

function getLocalHourFromReference(timeZone, utcMs) {
  const parts = getDateTimeFormatter(timeZone, {
    hour12: false,
    hourCycle: "h23",
    hour: "2-digit"
  }).formatToParts(new Date(utcMs));
  const hourPart = parts.find((part) => part.type === "hour");
  return Number(hourPart?.value ?? 0);
}

function getOffsetMinutes(timeZone, atMs = Date.now()) {
  const date = new Date(atMs);
  const parts = getDateTimeFormatter(timeZone, {
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);

  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return (asUtc - atMs) / 60000;
}

function getDateTimeFormatter(timeZone, options) {
  const key = JSON.stringify([timeZone, options]);
  if (!formatterCache.has(key)) {
    formatterCache.set(
      key,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        ...options
      })
    );
  }
  return formatterCache.get(key);
}

function formatZoneNow(timeZone) {
  return getDateTimeFormatter(timeZone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  })
    .format(new Date())
    .toUpperCase()
    .replace(/\s/g, "");
}

function startLiveClock() {
  setInterval(() => {
    updateClocks();
  }, 30_000);
}

function formatHour(hour) {
  const period = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  return `${h} ${period}`;
}

function isDayHour(hour) {
  return hour >= 6 && hour <= 21;
}

function isValidTimeZone(zone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function buildZoneMeta(timeZone) {
  const [region, cityRaw] = timeZone.split("/").slice(-2);
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  const city = (cityRaw || timeZone.split("/").pop() || timeZone)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  let subtitle = region ? region.replaceAll("_", " ") : timeZone;
  if (timeZone.startsWith("America/")) {
    subtitle = "Americas";
  } else if (timeZone.startsWith("Europe/")) {
    subtitle = "Europe";
  } else if (timeZone.startsWith("Asia/")) {
    subtitle = "Asia";
  } else if (timeZone.startsWith("Africa/")) {
    subtitle = "Africa";
  } else if (timeZone.startsWith("Pacific/")) {
    subtitle = "Pacific";
  }

  const regionGuess = extractRegionCode(timeZone);
  if (regionGuess) {
    try {
      subtitle = display.of(regionGuess) || subtitle;
    } catch {
      // ignore display names availability issues
    }
  }

  return { timeZone, title: city, subtitle };
}

function addZoneFromInput(zoneRaw = addZoneInput.value) {
  const zone = zoneRaw.trim();
  if (!zone) return;
  if (!isValidTimeZone(zone) && searchItems.length > 0) {
    const first = searchItems[0];
    addZoneEntry({
      timeZone: first.timeZone,
      title: first.title,
      subtitle: first.subtitle
    });
    return;
  }
  if (!isValidTimeZone(zone)) {
    addZoneInput.setCustomValidity("Unknown time zone");
    addZoneInput.reportValidity();
    return;
  }
  const built = ensureZoneEntry(buildZoneMeta(zone));
  if (state.zones.some((z) => isSameZoneLabel(z, built))) {
    addZoneInput.setCustomValidity("Zone already added");
    addZoneInput.reportValidity();
    return;
  }
  state.zones.push(built);
  addZoneInput.value = "";
  closeAddZonePanel();
  render();
}

function addZoneEntry(zoneEntry) {
  const normalized = ensureZoneEntry(zoneEntry);
  if (!isValidTimeZone(normalized.timeZone)) return false;
  if (state.zones.some((z) => isSameZoneLabel(z, normalized))) return false;
  state.zones.push(normalized);
  addZoneInput.value = "";
  closeAddZonePanel();
  render();
  return true;
}

function closeAddZonePanel() {
  addZonePanel.hidden = true;
  addZoneButton.classList.remove("is-open");
  hideSearchResults();
  if (autocompleteController) {
    autocompleteController.abort();
    autocompleteController = null;
  }
}

function renderSuggestedZones(query = "") {
  const lower = query.toLowerCase();
  const candidates = [];

  for (const zone of quickSuggestions) {
    if (state.zones.some((z) => z.timeZone === zone)) continue;
    if (lower && !zone.toLowerCase().includes(lower)) continue;
    candidates.push(zone);
  }

  if (candidates.length < 8) {
    for (const zone of timezoneValues) {
      if (candidates.includes(zone)) continue;
      if (state.zones.some((z) => z.timeZone === zone)) continue;
      if (lower && !zone.toLowerCase().includes(lower)) continue;
      candidates.push(zone);
      if (candidates.length >= 8) break;
    }
  }

  suggestedZonesEl.innerHTML = "";
  for (const zone of candidates.slice(0, 8)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggested-zone";
    button.textContent = zone;
    button.title = zone;
    button.addEventListener("click", () => addZoneFromInput(zone));
    suggestedZonesEl.append(button);
  }
}

function getSupportedTimeZones() {
  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone");
  }
  return quickSuggestions;
}

function scheduleAutocompleteSearch(query) {
  if (autocompleteTimer) window.clearTimeout(autocompleteTimer);
  autocompleteTimer = 0;

  if (!addZonePanel.hidden && query.length >= 2) {
    showSearchStatus("Searching...");
    autocompleteTimer = window.setTimeout(() => {
      runAutocompleteSearch(query);
    }, 140);
    return;
  }

  hideSearchResults();
}

async function runAutocompleteSearch(query) {
  if (autocompleteController) autocompleteController.abort();
  autocompleteController = new AbortController();

  try {
    const url = geoapifyKey ? new URL("https://api.geoapify.com/v1/geocode/autocomplete") : new URL("/api/geoapify-autocomplete", window.location.origin);
    url.searchParams.set("text", query);
    url.searchParams.set("limit", "8");

    if (geoapifyKey) {
      url.searchParams.set("format", "json");
      url.searchParams.set("lang", "en");
      url.searchParams.set("apiKey", geoapifyKey);
    }

    const response = await fetch(url, { signal: autocompleteController.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const results = normalizeGeoapifyResults(data?.results || []);
    searchItems = results;
    renderSearchResults(results, query);
  } catch (error) {
    if (error?.name === "AbortError") return;
    showSearchStatus("Search unavailable");
  }
}

function normalizeGeoapifyResults(results) {
  const normalized = [];
  const seen = new Set();

  for (const item of results) {
    const timeZone = extractGeoapifyTimeZone(item);
    if (!timeZone || !isValidTimeZone(timeZone)) continue;

    const cityName = item.city || item.town || item.village || item.hamlet || item.suburb || item.name || item.address_line1;
    if (!cityName) continue;

    const title = cityName;
    const subtitle = buildGeoSubtitle(item);
    const key = `${title}|${subtitle}|${timeZone}`;
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      label: item.formatted || `${title}, ${subtitle}`,
      title,
      subtitle,
      timeZone
    });
  }

  return normalized;
}

function extractGeoapifyTimeZone(item) {
  if (!item || !item.timezone) return null;
  if (typeof item.timezone === "string") return item.timezone;
  if (typeof item.timezone.name === "string") return item.timezone.name;
  if (typeof item.timezone.id === "string") return item.timezone.id;
  return null;
}

function buildGeoSubtitle(item) {
  const country = item.country || item.country_code?.toUpperCase() || "";
  const region =
    item.state_code ||
    item.state ||
    item.county ||
    item.region ||
    item.state_district ||
    "";

  if (country && region) return `${country}, ${region}`;
  return country || region || item.formatted || "";
}

function renderSearchResults(items, query) {
  searchResultsEl.innerHTML = "";

  if (!query || query.length < 2) {
    hideSearchResults();
    return;
  }

  searchResultsEl.hidden = false;

  if (items.length === 0) {
    showSearchStatus("No city matches");
    return;
  }

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.innerHTML = `
      <span class="search-result-title">${escapeHtml(item.title)}</span>
      <span class="search-result-subtitle">${escapeHtml(item.subtitle)} · ${escapeHtml(item.timeZone)}</span>
    `;
    button.addEventListener("click", () => {
      addZoneEntry({
        timeZone: item.timeZone,
        title: item.title,
        subtitle: item.subtitle
      });
    });
    searchResultsEl.append(button);
  }
}

function showSearchStatus(text) {
  searchResultsEl.hidden = false;
  searchResultsEl.innerHTML = `<div class="search-status">${escapeHtml(text)}</div>`;
}

function hideSearchResults() {
  searchResultsEl.hidden = true;
  searchResultsEl.innerHTML = "";
  searchItems = [];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function wireColumnDragEvents(column, zone) {
  column.addEventListener("dragstart", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".remove-zone") || target?.closest(".hours")) {
      event.preventDefault();
      return;
    }

    dragState = { sourceZoneId: zone.id, overZoneId: null, position: null };
    column.classList.add("is-dragging");

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", zone.id);
    }
  });

  column.addEventListener("dragover", (event) => {
    if (!dragState || dragState.sourceZoneId === zone.id) return;
    event.preventDefault();

    const rect = column.getBoundingClientRect();
    const position = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    dragState.overZoneId = zone.id;
    dragState.position = position;
    applyDropMarkers();
  });

  column.addEventListener("drop", (event) => {
    if (!dragState) return;
    event.preventDefault();

    if (dragState.overZoneId && dragState.position) {
      reorderZones(dragState.sourceZoneId, dragState.overZoneId, dragState.position);
      clearDragVisualState();
      render();
      return;
    }

    clearDragVisualState();
  });

  column.addEventListener("dragend", () => {
    clearDragVisualState();
  });
}

function applyDropMarkers() {
  for (const view of columnViews) {
    view.column.classList.remove("drop-before", "drop-after");
    if (!dragState || view.zone.id !== dragState.overZoneId) continue;
    view.column.classList.add(dragState.position === "before" ? "drop-before" : "drop-after");
  }
}

function clearDragVisualState() {
  dragState = null;
  for (const view of columnViews) {
    view.column.classList.remove("is-dragging", "drop-before", "drop-after");
  }
}

function reorderZones(sourceZoneId, targetZoneId, position) {
  if (!sourceZoneId || !targetZoneId || sourceZoneId === targetZoneId) return;

  const zones = [...state.zones];
  const sourceIndex = zones.findIndex((z) => z.id === sourceZoneId);
  const targetIndex = zones.findIndex((z) => z.id === targetZoneId);
  if (sourceIndex < 0 || targetIndex < 0) return;

  const [moved] = zones.splice(sourceIndex, 1);
  const targetIndexAfterRemoval = zones.findIndex((z) => z.id === targetZoneId);
  const insertIndex = position === "before" ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1;
  zones.splice(insertIndex, 0, moved);
  state.zones = zones;
}

function updateClocks() {
  for (const view of columnViews) {
    view.liveClock.textContent = formatZoneNow(view.zone.timeZone);
  }
}

function updateHighlights() {
  const reference = state.selected;
  const selectedIndex = reference ? columnViews.findIndex((view) => view.zone.id === reference.zoneId) : -1;
  let cascadeStep = 0;

  for (const view of columnViews) {
    let activeLocalHour = null;
    if (reference) {
      activeLocalHour = getLocalHourFromReference(view.zone.timeZone, reference.utcMs);
    }

    for (const row of view.rowsByHour) {
      row.classList.remove("is-active", "is-link");
    }

    view.selectionBar.classList.remove("visible", "tone-day", "tone-night", "instant");
    view.selectionBar.style.transitionDelay = "0ms, 0ms, 0ms";

    if (activeLocalHour === null) {
      continue;
    }

    const row = view.rowsByHour[activeLocalHour];
    const toneClass = isDayHour(activeLocalHour) ? "tone-day" : "tone-night";

    if (reference.zoneId === view.zone.id) {
      row.classList.add("is-active");
    } else {
      row.classList.add("is-link");
    }

    // Move a persistent bar so the color appears to slide between rows.
    const y = row.offsetTop + 6;
    view.selectionBar.style.transform = `translateY(${y}px)`;

    const viewIndex = columnViews.indexOf(view);
    const delay = viewIndex === selectedIndex ? 0 : ++cascadeStep * CASCADE_DELAY_MS;
    view.selectionBar.style.transitionDelay = `${delay}ms, ${delay}ms, ${delay}ms`;
    view.selectionBar.classList.add("visible", toneClass);
  }

  syncUrlState();
}

function extractRegionCode(timeZone) {
  const map = {
    "America/New_York": "US",
    "America/Los_Angeles": "US",
    "America/Chicago": "US",
    "America/Denver": "US",
    "America/Phoenix": "US",
    "America/Anchorage": "US",
    "America/Adak": "US",
    "America/Edmonton": "CA",
    "Europe/Warsaw": "PL",
    "Asia/Bangkok": "TH"
  };
  return map[timeZone];
}

function ensureZoneEntry(zone) {
  return {
    id: zone.id || createZoneId(),
    timeZone: zone.timeZone,
    title: zone.title,
    subtitle: zone.subtitle
  };
}

function createZoneId() {
  return `z${nextZoneId++}`;
}

function isSameZoneLabel(a, b) {
  return a.timeZone === b.timeZone && a.title === b.title && a.subtitle === b.subtitle;
}

function syncUrlState() {
  const stateParam = encodeShareState();
  const url = new URL(window.location.href);
  if (stateParam) {
    url.searchParams.set("state", stateParam);
  } else {
    url.searchParams.delete("state");
  }
  window.history.replaceState(null, "", url);
}

function encodeShareState() {
  const payload = {
    zones: state.zones.map((zone) => ({
      id: zone.id,
      timeZone: zone.timeZone,
      title: zone.title,
      subtitle: zone.subtitle
    })),
    selected: state.selected
      ? {
          zoneId: state.selected.zoneId || null,
          timeZone: state.selected.timeZone,
          localHour: state.selected.localHour
        }
      : null
  };

  return base64UrlEncode(JSON.stringify(payload));
}

function hydrateStateFromUrl() {
  const url = new URL(window.location.href);
  const raw = url.searchParams.get("state");
  if (!raw) return;

  try {
    const decoded = JSON.parse(base64UrlDecode(raw));
    const zones = Array.isArray(decoded?.zones) ? decoded.zones : [];
    const validZones = zones
      .filter((zone) => zone && typeof zone.timeZone === "string" && isValidTimeZone(zone.timeZone))
      .map((zone) => ({
        id: typeof zone.id === "string" && zone.id ? zone.id : undefined,
        timeZone: zone.timeZone,
        title: typeof zone.title === "string" && zone.title.trim() ? zone.title.trim() : buildZoneMeta(zone.timeZone).title,
        subtitle:
          typeof zone.subtitle === "string" && zone.subtitle.trim()
            ? zone.subtitle.trim()
            : buildZoneMeta(zone.timeZone).subtitle
      }));

    if (validZones.length > 0) {
      state.zones = dedupeZones(validZones.map((zone) => ensureZoneEntry(zone)));
    }

    const selected = decoded?.selected;
    if (
      selected &&
      typeof selected.timeZone === "string" &&
      Number.isInteger(selected.localHour) &&
      selected.localHour >= 0 &&
      selected.localHour <= 23 &&
      state.zones.some((z) => (selected.zoneId && z.id === selected.zoneId) || z.timeZone === selected.timeZone)
    ) {
      const matchedZone =
        state.zones.find((z) => selected.zoneId && z.id === selected.zoneId) ||
        state.zones.find((z) => z.timeZone === selected.timeZone);
      state.selected = getReferenceFromLocalHour(
        matchedZone.timeZone,
        selected.localHour,
        Date.now(),
        matchedZone.id
      );
    }
  } catch {
    // Ignore invalid shared state payloads.
  }
}

function dedupeZones(zones) {
  const seen = new Set();
  const result = [];
  for (const zone of zones) {
    const key = zone.id || `${zone.timeZone}|${zone.title}|${zone.subtitle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(zone.id ? zone : ensureZoneEntry(zone));
  }
  return result;
}

async function shareCurrentState() {
  const url = buildShareUrl();

  try {
    await navigator.clipboard.writeText(url);
    pulseShareSuccess();
  } catch {
    window.prompt("Copy link", url);
  }
}

function buildShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("state", encodeShareState());
  return url.toString();
}

function pulseShareSuccess() {
  shareStateButton.classList.add("is-copied");
  if (shareSuccessTimer) window.clearTimeout(shareSuccessTimer);
  shareSuccessTimer = window.setTimeout(() => {
    shareStateButton.classList.remove("is-copied");
  }, 700);
}

function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(text) {
  const normalized = text.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
