const EUROPE_REGION_CODES = new Set([
  "AL", "AD", "AT", "BY", "BE", "BA", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IS", "IE", "IT", "XK", "LV", "LI", "LT", "LU", "MT", "MD", "MC",
  "ME", "NL", "MK", "NO", "PL", "PT", "RO", "RU", "SM", "RS", "SK", "SI", "ES", "SE",
  "CH", "UA", "GB", "VA"
]);

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const countryCode = getCountryCodeFromHeaders(req.headers);
  const regionCode = getHeader(req.headers, "x-vercel-ip-country-region");
  const city = decodeHeaderValue(getHeader(req.headers, "x-vercel-ip-city"));
  const timeZone = getHeader(req.headers, "x-vercel-ip-timezone");
  const hourFormat = countryCode && EUROPE_REGION_CODES.has(countryCode) ? "24h" : "12h";

  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  return res.status(200).json({
    city: city || null,
    countryCode: countryCode || null,
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
