const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const HOUR_MS = 60 * 60 * 1000;
const CASCADE_DELAY_MS = 50;
const ROW_HIGHLIGHT_INSET_PX = 4;
const REMOVE_FADE_MS = 100;
const REMOVE_MOVE_DELAY_MS = 60;
const COLUMN_FILL_MS = 100;
const ADD_FADE_MS = 100;
const THEME_STORAGE_KEY = "when-there-theme";
const THEME_MODES = ["system", "light", "dark"];
const EUROPE_REGION_CODES = new Set([
  "AL", "AD", "AT", "BY", "BE", "BA", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IS", "IE", "IT", "XK", "LV", "LI", "LT", "LU", "MT", "MD", "MC",
  "ME", "NL", "MK", "NO", "PL", "PT", "RO", "RU", "SM", "RS", "SK", "SI", "ES", "SE",
  "CH", "UA", "GB", "VA"
]);
let userHourFormat = detectUserHourFormat();

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
  selected: null,
  editingZoneId: null
};

const timelineEl = document.querySelector("#timeline");
const addZoneButton = document.querySelector("#add-zone-button");
const themeToggleButton = document.querySelector("#theme-toggle-button");
const shareStateButton = document.querySelector("#share-state-button");
const addZonePanel = document.querySelector("#add-zone-panel");
const addZoneForm = document.querySelector("#add-zone-form");
const addZoneInput = document.querySelector("#add-zone-input");
const searchResultsEl = document.querySelector("#search-results");
const suggestedWrapEl = document.querySelector(".suggested-wrap");
const suggestedZonesEl = document.querySelector("#suggested-zones");
const columnTemplate = document.querySelector("#column-template");
const formatterCache = new Map();
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
let themeMode = "system";
let fistBumpOverlayEl = null;
let fistBumpOverlayTimer = 0;
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

bootstrap();

async function bootstrap() {
  initThemeMode();
  const viewerContext = await hydrateHourFormatFromServer();
  applyViewerDrivenDefaults(viewerContext);
  hydrateStateFromUrl();
  ensureDefaultSelection();
  wireEvents();
  startLiveClock();
  render();
}

function wireEvents() {
  addZoneButton.addEventListener("click", () => {
    if (addZonePanel.hidden) {
      openAddZonePanel();
      return;
    }
    closeAddZonePanel();
  });
  themeToggleButton.addEventListener("click", () => {
    cycleThemeMode();
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
  window.addEventListener("resize", () => {
    updateHighlights();
    updateCurrentTimeLines();
  });
  if (typeof systemThemeQuery.addEventListener === "function") {
    systemThemeQuery.addEventListener("change", handleSystemThemeChange);
  } else if (typeof systemThemeQuery.addListener === "function") {
    systemThemeQuery.addListener(handleSystemThemeChange);
  }
}

function initThemeMode() {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (THEME_MODES.includes(stored)) {
    themeMode = stored;
  }
  applyThemeMode(themeMode);
}

function cycleThemeMode() {
  const currentIndex = THEME_MODES.indexOf(themeMode);
  const nextMode = THEME_MODES[(currentIndex + 1) % THEME_MODES.length];
  applyThemeMode(nextMode);
}

function applyThemeMode(mode) {
  themeMode = THEME_MODES.includes(mode) ? mode : "system";
  const root = document.documentElement;
  root.classList.toggle("theme-light", themeMode === "light");
  root.classList.toggle("theme-dark", themeMode === "dark");

  if (themeMode === "system") {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }

  updateThemeToggleUi();
}

function handleSystemThemeChange() {
  if (themeMode !== "system") return;
  updateThemeToggleUi();
}

function updateThemeToggleUi() {
  const glyphEl = themeToggleButton.querySelector(".theme-glyph");
  const tooltipEl = themeToggleButton.querySelector(".action-tooltip");
  const isSystemDark = systemThemeQuery.matches;
  const effectiveMode = themeMode === "system" ? (isSystemDark ? "dark" : "light") : themeMode;
  const glyph = themeMode === "system" ? "◐" : themeMode === "light" ? "◌" : "◑";

  glyphEl.textContent = glyph;
  themeToggleButton.dataset.themeMode = themeMode;
  themeToggleButton.setAttribute("aria-label", `Theme mode: ${themeMode}. Click to switch.`);
  tooltipEl.textContent = `theme: ${themeMode}${themeMode === "system" ? ` (${effectiveMode})` : ""}`;
}

function openAddZonePanel({ editingZoneId = null, initialValue = "", anchorEl = null } = {}) {
  state.editingZoneId = editingZoneId;
  addZonePanel.hidden = false;
  addZoneButton.classList.add("is-open");
  addZoneInput.setCustomValidity("");
  addZoneInput.value = initialValue;
  renderSuggestedZones(initialValue.trim());
  hideSearchResults();
  if (anchorEl) {
    positionAddZonePanelNearAnchor(anchorEl);
  } else {
    resetAddZonePanelPosition();
  }
  addZoneInput.focus();
  addZoneInput.select();
}

function render(previousRects = null, options = {}) {
  timelineEl.innerHTML = "";
  columnViews = [];

  for (const zone of state.zones) {
    const column = columnTemplate.content.firstElementChild.cloneNode(true);
    const titleEl = column.querySelector(".zone-title");
    const subtitleEl = column.querySelector(".zone-subtitle");
    const titleWrapEl = column.querySelector(".zone-title-wrap");
    const removeButton = column.querySelector(".remove-zone");
    const hoursEl = column.querySelector(".hours");
    column.dataset.zoneId = zone.id;
    column.draggable = true;
    column.classList.add("is-draggable");

    titleEl.textContent = zone.title;
    subtitleEl.textContent = zone.subtitle;
    titleWrapEl.tabIndex = 0;
    titleWrapEl.setAttribute("role", "button");
    titleWrapEl.setAttribute("aria-label", `Change location for ${zone.title}`);
    titleWrapEl.addEventListener("click", () => {
      openAddZonePanel({ editingZoneId: zone.id, initialValue: zone.timeZone, anchorEl: titleWrapEl });
    });
    titleWrapEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openAddZonePanel({ editingZoneId: zone.id, initialValue: zone.timeZone, anchorEl: titleWrapEl });
    });
    removeButton.hidden = state.zones.length <= 1;
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeZoneWithAnimation(zone.id, column);
    });
    wireColumnDragEvents(column, zone);
    const selectionBar = document.createElement("div");
    selectionBar.className = "selection-bar";
    selectionBar.setAttribute("aria-hidden", "true");
    hoursEl.append(selectionBar);
    const currentTimeLine = document.createElement("div");
    currentTimeLine.className = "current-time-line";
    currentTimeLine.setAttribute("aria-hidden", "true");
    hoursEl.append(currentTimeLine);
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
    titleWrapEl.append(liveClock);

    columnViews.push({ zone, column, hoursEl, rowsByHour, liveClock, selectionBar, currentTimeLine });
    timelineEl.append(column);
  }

  updateHighlights();
  updateCurrentTimeLines();
  animateColumnFill(previousRects, options);
}

function captureColumnRects() {
  const rects = new Map();
  for (const view of columnViews) {
    rects.set(view.zone.id, view.column.getBoundingClientRect());
  }
  return rects;
}

function animateColumnFill(previousRects, options = {}) {
  const enterZoneId = options.enterZoneId || null;
  const hasPreviousRects = previousRects instanceof Map && previousRects.size > 0;
  if (!hasPreviousRects && !enterZoneId) return;

  const shifted = [];
  const entering = [];
  for (const view of columnViews) {
    if (!hasPreviousRects) {
      if (enterZoneId && view.zone.id === enterZoneId) {
        view.column.style.transition = "none";
        view.column.style.opacity = "0";
        entering.push(view.column);
      }
      continue;
    }

    const prev = previousRects.get(view.zone.id);
    if (!prev) {
      if (enterZoneId && view.zone.id === enterZoneId) {
        view.column.style.transition = "none";
        view.column.style.opacity = "0";
        entering.push(view.column);
      }
      continue;
    }
    const next = view.column.getBoundingClientRect();
    const dx = prev.left - next.left;
    const dy = prev.top - next.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

    view.column.style.transition = "none";
    view.column.style.transform = `translate(${dx}px, ${dy}px)`;
    shifted.push(view.column);
  }

  if (shifted.length === 0 && entering.length === 0) return;

  requestAnimationFrame(() => {
    for (const column of shifted) {
      column.style.transition = `transform ${COLUMN_FILL_MS}ms ease-out`;
      column.style.transform = "";
    }
    for (const column of entering) {
      column.style.transition = `opacity ${ADD_FADE_MS}ms ease-in`;
      column.style.opacity = "1";
    }
    window.setTimeout(() => {
      for (const column of [...shifted, ...entering]) {
        column.style.transition = "";
        column.style.opacity = "";
      }
    }, Math.max(COLUMN_FILL_MS, ADD_FADE_MS) + 20);
  });
}

function removeZoneWithAnimation(zoneId, column) {
  if (state.zones.length <= 1) return;
  if (column.classList.contains("is-removing")) return;

  const previousRects = captureColumnRects();
  createRemovalGhost(column);
  column.style.visibility = "hidden";
  column.classList.add("is-removing");

  window.setTimeout(() => {
    state.zones = state.zones.filter((z) => z.id !== zoneId);
    if (state.selected?.zoneId === zoneId) {
      state.selected = null;
    }
    if (state.editingZoneId === zoneId) {
      closeAddZonePanel();
    }
    render(previousRects);
  }, REMOVE_MOVE_DELAY_MS);
}

function createRemovalGhost(column) {
  const rect = column.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const ghost = column.cloneNode(true);
  ghost.classList.remove("is-removing", "is-dragging", "drop-before", "drop-after");
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.position = "fixed";
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.margin = "0";
  ghost.style.zIndex = "30";
  ghost.style.pointerEvents = "none";
  ghost.style.transition = `opacity ${REMOVE_FADE_MS}ms ease-in`;
  ghost.style.opacity = "1";
  document.body.append(ghost);

  requestAnimationFrame(() => {
    ghost.style.opacity = "0";
  });

  window.setTimeout(() => {
    ghost.remove();
  }, REMOVE_FADE_MS + 30);
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
  const formatted = getDateTimeFormatter(timeZone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: userHourFormat === "12h"
  }).format(new Date());

  return userHourFormat === "12h"
    ? formatted.toUpperCase().replace(/\s/g, "")
    : formatted;
}

function startLiveClock() {
  setInterval(() => {
    updateClocks();
  }, 30_000);
}

function formatHour(hour) {
  if (userHourFormat === "24h") {
    return `${String(hour).padStart(2, "0")}:00`;
  }
  const period = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  return `${h} ${period}`;
}

async function hydrateHourFormatFromServer() {
  try {
    const response = await fetch("/api/viewer-hour-format", { headers: { Accept: "application/json" } });
    if (!response.ok) {
      console.info("[when-there] hour format source=fallback-browser reason=http", response.status, userHourFormat);
      return null;
    }
    const data = await response.json();
    if (data?.hourFormat === "24h" || data?.hourFormat === "12h") {
      userHourFormat = data.hourFormat;
    }
    console.info(
      "[when-there] hour format source=%s country=%s format=%s",
      data?.source || "server",
      data?.countryCode || "unknown",
      userHourFormat
    );
    return data;
  } catch {
    // Local static dev and non-Vercel hosts may not have this endpoint.
    console.info("[when-there] hour format source=fallback-browser reason=unavailable format=%s", userHourFormat);
    return null;
  }
}

function applyViewerDrivenDefaults(viewerContext) {
  const defaultPortland = { timeZone: "America/Los_Angeles", title: "Portland", subtitle: "United States, OR" };
  const defaultThailand = { timeZone: "Asia/Bangkok", title: "Bangkok", subtitle: "Thailand" };

  const viewerZone = buildViewerDefaultZone(viewerContext);
  const pinned = [viewerZone || DEFAULT_ZONES[0], defaultPortland, defaultThailand].filter(Boolean);
  const remaining = DEFAULT_ZONES.filter(
    (zone) => zone.timeZone !== defaultPortland.timeZone && !pinned.some((p) => p.timeZone === zone.timeZone)
  );
  const ordered = [...pinned, ...remaining];

  state.zones = ordered.map((zone) => ensureZoneEntry(zone));
  state.selected = null;
}

function buildViewerDefaultZone(viewerContext) {
  if (!viewerContext || typeof viewerContext !== "object") return null;

  const timeZone = String(viewerContext.timeZone || "").trim();
  if (!timeZone || !isValidTimeZone(timeZone)) return null;

  const fallbackMeta = buildZoneMeta(timeZone);
  const city = String(viewerContext.city || "").trim();
  const countryCode = String(viewerContext.countryCode || "").trim().toUpperCase();
  const regionCode = String(viewerContext.regionCode || "").trim().toUpperCase();

  let subtitle = fallbackMeta.subtitle;
  if (countryCode && regionCode) {
    subtitle = `${countryCode}, ${regionCode}`;
  } else if (countryCode) {
    subtitle = countryCode;
  }

  return {
    timeZone,
    title: city || fallbackMeta.title,
    subtitle
  };
}

function detectUserHourFormat() {
  const timeZone = getViewerTimeZone();
  if (timeZone.startsWith("Europe/")) return "24h";
  if (timeZone.startsWith("America/")) return "12h";

  const region = getViewerRegionCode();
  if (region && EUROPE_REGION_CODES.has(region)) return "24h";
  if (region && ["US", "CA", "MX", "BR", "AR", "CL", "CO", "PE", "VE"].includes(region)) return "12h";

  return "12h";
}

function getViewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function getViewerRegionCode() {
  const locales = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language].filter(Boolean);

  for (const locale of locales) {
    const region = extractRegionFromLocale(locale);
    if (region) return region;
  }
  return "";
}

function extractRegionFromLocale(locale) {
  try {
    if (typeof Intl.Locale === "function") {
      const region = new Intl.Locale(locale).maximize().region || new Intl.Locale(locale).region;
      if (region) return region.toUpperCase();
    }
  } catch {
    // ignore unsupported Intl.Locale
  }

  const match = String(locale).match(/[-_]([A-Za-z]{2}|\d{3})(?:[-_]|$)/);
  return match ? match[1].toUpperCase() : "";
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
  if (hasDuplicateZone(built, state.editingZoneId)) {
    addZoneInput.setCustomValidity("Zone already added");
    addZoneInput.reportValidity();
    return;
  }
  applyZoneChange(built);
}

function addZoneEntry(zoneEntry) {
  const normalized = ensureZoneEntry(zoneEntry);
  if (!isValidTimeZone(normalized.timeZone)) return false;
  if (hasDuplicateZone(normalized, state.editingZoneId)) return false;
  return applyZoneChange(normalized);
}

function hasDuplicateZone(candidate, excludeZoneId = null) {
  return state.zones.some((z) => z.id !== excludeZoneId && isSameZoneLabel(z, candidate));
}

function applyZoneChange(zoneEntry) {
  const normalized = ensureZoneEntry(zoneEntry);
  const editingZoneId = state.editingZoneId;
  let previousRects = null;
  let enterZoneId = null;

  if (editingZoneId) {
    normalized.id = editingZoneId;
    state.zones = state.zones.map((z) => (z.id === editingZoneId ? normalized : z));
    if (state.selected?.zoneId === editingZoneId) {
      state.selected = getReferenceFromLocalHour(
        normalized.timeZone,
        state.selected.localHour,
        Date.now(),
        editingZoneId
      );
    }
  } else {
    previousRects = captureColumnRects();
    state.zones.push(normalized);
    enterZoneId = normalized.id;
  }

  addZoneInput.value = "";
  closeAddZonePanel();
  render(previousRects, { enterZoneId });
  return true;
}

function closeAddZonePanel() {
  addZonePanel.hidden = true;
  addZoneButton.classList.remove("is-open");
  state.editingZoneId = null;
  resetAddZonePanelPosition();
  hideSearchResults();
  if (autocompleteController) {
    autocompleteController.abort();
    autocompleteController = null;
  }
}

function resetAddZonePanelPosition() {
  addZonePanel.style.left = "";
  addZonePanel.style.top = "";
  addZonePanel.style.bottom = "";
  addZonePanel.style.transform = "";
}

function positionAddZonePanelNearAnchor(anchorEl) {
  const anchorRect = anchorEl.getBoundingClientRect();
  const viewportPadding = 8;
  const gap = 8;
  const panelRect = addZonePanel.getBoundingClientRect();
  const panelWidth = panelRect.width || 280;
  const panelHeight = panelRect.height || 220;

  let left = anchorRect.left + anchorRect.width + gap;
  if (left + panelWidth > window.innerWidth - viewportPadding) {
    left = anchorRect.right - panelWidth;
  }
  left = Math.max(viewportPadding, Math.min(left, window.innerWidth - panelWidth - viewportPadding));

  let top = anchorRect.top - 4;
  if (top + panelHeight > window.innerHeight - viewportPadding) {
    top = window.innerHeight - panelHeight - viewportPadding;
  }
  top = Math.max(viewportPadding, top);

  addZonePanel.style.left = `${Math.round(left)}px`;
  addZonePanel.style.top = `${Math.round(top)}px`;
  addZonePanel.style.bottom = "auto";
  addZonePanel.style.transform = "none";
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

  const visibleCandidates = candidates.slice(0, 8);
  suggestedWrapEl.hidden = visibleCandidates.length === 0;
  suggestedZonesEl.innerHTML = "";
  for (const zone of visibleCandidates) {
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
    const url = new URL("/api/geoapify-autocomplete", window.location.origin);
    url.searchParams.set("text", query);
    url.searchParams.set("limit", "8");

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
  updateCurrentTimeLines();
}

function getLocalHourMinute(timeZone, atMs = Date.now()) {
  const parts = getDateTimeFormatter(timeZone, {
    hour12: false,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date(atMs));
  const hourPart = parts.find((part) => part.type === "hour");
  const minutePart = parts.find((part) => part.type === "minute");
  return {
    hour: Number(hourPart?.value ?? 0),
    minute: Number(minutePart?.value ?? 0)
  };
}

function updateCurrentTimeLines(nowMs = Date.now()) {
  const date = new Date(nowMs);
  const secondFraction = (date.getUTCSeconds() + date.getUTCMilliseconds() / 1000) / 60;

  for (const view of columnViews) {
    const { hour, minute } = getLocalHourMinute(view.zone.timeZone, nowMs);
    const row = view.rowsByHour[hour];
    if (!row) {
      view.currentTimeLine.classList.remove("visible");
      continue;
    }

    const minuteProgress = Math.min(0.999, (minute + secondFraction) / 60);
    const y = row.offsetTop + row.offsetHeight * minuteProgress;
    view.currentTimeLine.style.transform = `translateY(${y}px)`;
    view.currentTimeLine.classList.add("visible");
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
    const y = row.offsetTop + ROW_HIGHLIGHT_INSET_PX;
    const barHeight = Math.max(0, row.offsetHeight - ROW_HIGHLIGHT_INSET_PX * 2);
    view.selectionBar.style.height = `${barHeight}px`;
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

function ensureDefaultSelection() {
  if (state.selected || state.zones.length === 0) return;

  const preferredZone =
    state.zones.find((zone) => zone.title.toLowerCase() === "portland" && zone.timeZone === "America/Los_Angeles") ||
    state.zones[0];

  const now = Date.now();
  const localHour = getLocalHourFromReference(preferredZone.timeZone, now);
  state.selected = getReferenceFromLocalHour(preferredZone.timeZone, localHour, now, preferredZone.id);
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
  triggerFistBumpOverlay();
  if (shareSuccessTimer) window.clearTimeout(shareSuccessTimer);
  shareSuccessTimer = window.setTimeout(() => {
    shareStateButton.classList.remove("is-copied");
  }, 700);
}

function triggerFistBumpOverlay() {
  const overlay = ensureFistBumpOverlay();
  overlay.classList.remove("is-active");
  // Force restart of CSS animation sequence.
  void overlay.offsetWidth;
  overlay.classList.add("is-active");

  if (fistBumpOverlayTimer) window.clearTimeout(fistBumpOverlayTimer);
  fistBumpOverlayTimer = window.setTimeout(() => {
    overlay.classList.remove("is-active");
  }, 1200);
}

function ensureFistBumpOverlay() {
  if (fistBumpOverlayEl) return fistBumpOverlayEl;

  const overlay = document.createElement("div");
  overlay.className = "fist-bump-overlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="fist-bump-overlay__veil"></div>
    <div class="fist-bump-overlay__flash"></div>
    <div class="fist-bump-overlay__fists">
      <span class="fist-bump-overlay__fist fist-bump-overlay__fist--left">🤜</span>
      <span class="fist-bump-overlay__fist fist-bump-overlay__fist--right">🤛</span>
    </div>
  `;
  document.body.append(overlay);
  fistBumpOverlayEl = overlay;
  return overlay;
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
