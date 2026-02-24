const EUROPE_REGION_CODES = new Set([
  "AL", "AD", "AT", "BY", "BE", "BA", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IS", "IE", "IT", "XK", "LV", "LI", "LT", "LU", "MT", "MD", "MC",
  "ME", "NL", "MK", "NO", "PL", "PT", "RO", "RU", "SM", "RS", "SK", "SI", "ES", "SE",
  "CH", "UA", "GB", "VA"
]);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const countryCode = getCountryCodeFromHeaders(req.headers);
  const regionCode = getHeader(req.headers, "x-vercel-ip-country-region");
  const city = decodeHeaderValue(getHeader(req.headers, "x-vercel-ip-city"));
  const timeZone = getHeader(req.headers, "x-vercel-ip-timezone");
  const latitude = getHeader(req.headers, "x-vercel-ip-latitude");
  const longitude = getHeader(req.headers, "x-vercel-ip-longitude");
  const hourFormat = countryCode && EUROPE_REGION_CODES.has(countryCode) ? "24h" : "12h";
  const geoapifyPlace = await getGeoapifyViewerPlace({ latitude, longitude });

  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  return res.status(200).json({
    city: city || null,
    countryCode: countryCode || null,
    geoapifyPlace,
    regionCode: regionCode || null,
    timeZone: timeZone || null,
    hourFormat,
    source: countryCode ? "ip-country-header" : "fallback-default"
  });
}

function getCountryCodeFromHeaders(headers = {}) {
  const code = getHeader(headers, "x-vercel-ip-country") || getHeader(headers, "cf-ipcountry") || getHeader(headers, "x-country-code");
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function getHeader(headers = {}, key) {
  const raw = headers[key] || "";
  return String(Array.isArray(raw) ? raw[0] : raw).trim();
}

function decodeHeaderValue(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function getGeoapifyViewerPlace({ latitude, longitude }) {
  const apiKey = process.env.GEOAPIFY;
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!apiKey || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  try {
    const url = new URL("https://api.geoapify.com/v1/geocode/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("lang", "en");
    url.searchParams.set("apiKey", apiKey);

    const upstream = await fetch(url);
    if (!upstream.ok) return null;
    const data = await upstream.json();
    const item = Array.isArray(data?.results) ? data.results[0] : null;
    if (!item) return null;

    const tz = extractGeoapifyTimeZone(item);
    const cityName =
      item.city ||
      item.town ||
      item.village ||
      item.hamlet ||
      item.suburb ||
      item.name ||
      item.address_line1 ||
      "";
    if (!cityName) return null;

    return {
      title: cityName,
      subtitle: buildGeoSubtitle(item),
      timeZone: tz || null
    };
  } catch {
    return null;
  }
}

function extractGeoapifyTimeZone(item) {
  if (!item || !item.timezone) return "";
  if (typeof item.timezone === "string") return item.timezone;
  if (typeof item.timezone.name === "string") return item.timezone.name;
  if (typeof item.timezone.id === "string") return item.timezone.id;
  return "";
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
