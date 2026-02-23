const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const HOUR_MS = 60 * 60 * 1000;

const DEFAULT_ZONES = [
  { timeZone: "America/Los_Angeles", title: "Portland", subtitle: "United States, OR" },
  { timeZone: "America/Edmonton", title: "Calgary", subtitle: "Canada, AB" },
  { timeZone: "America/Chicago", title: "Houston", subtitle: "United States, TX" },
  { timeZone: "Europe/Warsaw", title: "Warsaw", subtitle: "Poland" },
  { timeZone: "Asia/Bangkok", title: "Bangkok", subtitle: "Thailand" }
];

const state = {
  zones: [...DEFAULT_ZONES],
  selected: null
};

const timelineEl = document.querySelector("#timeline");
const addZoneButton = document.querySelector("#add-zone-button");
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

bootstrap();

function bootstrap() {
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

    titleEl.textContent = zone.title;
    subtitleEl.textContent = zone.subtitle;
    removeButton.hidden = state.zones.length <= 1;
    removeButton.addEventListener("click", () => {
      state.zones = state.zones.filter((z) => z.timeZone !== zone.timeZone);
      render();
    });
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
      row.dataset.hour = String(hour);
      row.innerHTML = `<span>${formatHour(hour)}</span>`;
      row.classList.add(isDayHour(hour) ? "tone-day" : "tone-night");

      row.addEventListener("focus", () => {
        // Focus does not preview selection; click commits selection.
      });

      row.addEventListener("click", () => {
        state.selected = getReferenceFromLocalHour(zone.timeZone, hour, Date.now());
        updateHighlights();
      });

      rowsByHour[hour] = row;
      hoursEl.append(row);
    }

    const liveClock = document.createElement("div");
    liveClock.className = "timezone-meta";
    liveClock.textContent = formatZoneNow(zone.timeZone);
    hoursEl.prepend(liveClock);

    columnViews.push({ zone, hoursEl, rowsByHour, liveClock, selectionBar });
    timelineEl.append(column);
  }

  updateHighlights();
}

function getReferenceFromLocalHour(timeZone, localHour, anchorUtcMs = Date.now()) {
  const offsetHours = getOffsetMinutes(timeZone, anchorUtcMs) / 60;
  const utcHour = localHour - offsetHours;
  return {
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
  if (state.zones.some((z) => z.timeZone === zone)) {
    addZoneInput.setCustomValidity("Zone already added");
    addZoneInput.reportValidity();
    return;
  }
  state.zones.push(buildZoneMeta(zone));
  addZoneInput.value = "";
  closeAddZonePanel();
  render();
}

function addZoneEntry(zoneEntry) {
  if (!isValidTimeZone(zoneEntry.timeZone)) return false;
  if (state.zones.some((z) => z.timeZone === zoneEntry.timeZone)) return false;
  state.zones.push(zoneEntry);
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

function updateClocks() {
  for (const view of columnViews) {
    view.liveClock.textContent = formatZoneNow(view.zone.timeZone);
  }
}

function updateHighlights() {
  const reference = state.selected;
  const source = state.selected ? "selected" : null;

  for (const view of columnViews) {
    let activeLocalHour = null;
    if (reference) {
      activeLocalHour = getLocalHourFromReference(view.zone.timeZone, reference.utcMs);
    }

    for (const row of view.rowsByHour) {
      row.classList.remove("is-active", "is-link");
    }

    view.selectionBar.classList.remove("visible", "tone-day", "tone-night", "instant");

    if (activeLocalHour === null) {
      continue;
    }

    const row = view.rowsByHour[activeLocalHour];
    const toneClass = isDayHour(activeLocalHour) ? "tone-day" : "tone-night";

    if (reference.timeZone === view.zone.timeZone) {
      row.classList.add("is-active");
    } else {
      row.classList.add("is-link");
    }

    // Move a persistent bar so the color appears to slide between rows.
    const y = row.offsetTop + 6;
    view.selectionBar.style.transform = `translateY(${y}px)`;
    if (source === "hover") {
      view.selectionBar.classList.add("instant");
    }
    view.selectionBar.classList.add("visible", toneClass);
  }
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
