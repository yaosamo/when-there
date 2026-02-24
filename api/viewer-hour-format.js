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
  const hourFormat = countryCode && EUROPE_REGION_CODES.has(countryCode) ? "24h" : "12h";

  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  return res.status(200).json({
    countryCode: countryCode || null,
    hourFormat,
    source: countryCode ? "ip-country-header" : "fallback-default"
  });
}

function getCountryCodeFromHeaders(headers = {}) {
  const raw =
    headers["x-vercel-ip-country"] ||
    headers["cf-ipcountry"] ||
    headers["x-country-code"] ||
    "";

  const code = String(Array.isArray(raw) ? raw[0] : raw).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}
