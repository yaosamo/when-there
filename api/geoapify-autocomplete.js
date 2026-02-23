export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEOAPIFY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing GEOAPIFY env var" });
  }

  const text = String(req.query?.text || "").trim();
  const limitRaw = Number(req.query?.limit || 8);
  const limit = Math.max(1, Math.min(10, Number.isFinite(limitRaw) ? limitRaw : 8));

  if (text.length < 2) {
    return res.status(200).json({ results: [] });
  }

  try {
    const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
    url.searchParams.set("text", text);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("lang", "en");
    url.searchParams.set("apiKey", apiKey);

    const upstream = await fetch(url);
    const body = await upstream.text();

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(upstream.status).send(body);
  } catch (error) {
    return res.status(502).json({ error: "Geoapify request failed" });
  }
}
