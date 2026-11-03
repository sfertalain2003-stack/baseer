// Baseer shared server: lets anyone use Baseer for free without their own key.
// It forwards requests to Google Gemini using the GEMINI_KEY secret, which never reaches the phone.
// It also limits how much each device and each network can use per hour, so one person
// (or someone abusing the server) can't use up the free allowance for everyone.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_KEY = Deno.env.get("GEMINI_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Only Baseer's own site may use this server, and only these models.
const ALLOWED_ORIGINS = ["https://sfertalain2003-stack.github.io"];
const ALLOWED_MODELS = new Set([
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
  "gemini-3.8-flash-lite-tts",
]);
const MAX_BODY_BYTES = 6_000_000; // a photo plus a few seconds of voice
// Per hour. Walking mode sends about one photo every 3 seconds (~1200 an hour).
const DEVICE_LIMIT = 1500;
const IP_LIMIT = 4000; // several people can share one network
const USER_AGENT = "Baseer/1.0 (free app for blind people; https://sfertalain2003-stack.github.io/baseer/)";

function cors(origin: string | null): HeadersInit {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info, x-baseer-device",
    "Vary": "Origin",
  };
}

/** Counts this request. Returns false when the device or network is over its hourly limit. */
async function underLimit(device: string, ip: string): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY) return true;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bump_rate`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
      // Older app versions send no device id: count those by network only.
      body: JSON.stringify({ p_device: device, p_ip: ip, p_device_limit: device === "none" ? 1_000_000_000 : DEVICE_LIMIT, p_ip_limit: IP_LIMIT }),
    });
    if (!res.ok) { console.error("rate check failed", res.status, await res.text()); return true; }
    return (await res.json()) !== false;
  } catch (e) {
    console.error("rate check error", e);
    return true; // never block blind users because the counter is down
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return new Response("Forbidden", { status: 403, headers: cors(origin) });

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "once";
  const device = (req.headers.get("x-baseer-device") ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) || "none";
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!(await underLimit(device, ip))) {
    return new Response("Too many requests this hour", { status: 429, headers: { ...cors(origin), "retry-after": "600" } });
  }

  // Street name for "Where am I?" (OpenStreetMap asks apps to identify themselves).
  if (mode === "geocode") {
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    const lang = (url.searchParams.get("lang") ?? "en").replace(/[^a-zA-Z-]/g, "").slice(0, 10);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return new Response("Bad position", { status: 400, headers: cors(origin) });
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=${lang}`, {
      headers: { "user-agent": USER_AGENT, referer: "https://sfertalain2003-stack.github.io/baseer/" },
    });
    const headers = new Headers(cors(origin));
    headers.set("content-type", "application/json");
    headers.set("cache-control", "no-store");
    return new Response(r.body, { status: r.status, headers });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors(origin) });
  if (!GEMINI_KEY) return new Response("Server not set up", { status: 500, headers: cors(origin) });
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return new Response("Too large", { status: 413, headers: cors(origin) });

  // ?model=...&mode=stream|once
  const model = url.searchParams.get("model") ?? "";
  const stream = mode === "stream";
  if (!ALLOWED_MODELS.has(model)) return new Response("Model not allowed", { status: 400, headers: cors(origin) });

  const target = `https://generativelanguage.googleapis.com/v1beta/models/${model}:` +
    (stream ? "streamGenerateContent?alt=sse" : "generateContent");
  const upstream = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: req.body,
    // @ts-ignore Deno supports streaming request bodies
    duplex: "half",
  });

  const headers = new Headers(cors(origin));
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/json");
  headers.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers });
});
