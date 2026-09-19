// Supabase Edge Function — proxies calls to the Biblionet webservice so the
// app never holds the Biblionet account credentials client-side.
//
// The client sends { endpoint, params }; this function attaches the
// server-side username/password (set via `supabase secrets set`, never
// committed to the repo) and forwards the request to Biblionet, returning
// its JSON response as-is.
//
// Deploy: supabase functions deploy biblionet-proxy
// Secrets: supabase secrets set BIBLIONET_USERNAME=... BIBLIONET_PASSWORD=...

const BIBLIONET_BASE = 'https://biblionet.gr/webservice';

// Only the endpoints this app actually calls — keeps the proxy from being
// usable as an open relay to arbitrary Biblionet webservice methods.
const ALLOWED_ENDPOINTS = new Set([
  'search_titles',
  'get_title',
  'get_month_titles',
  'get_title_subject',
  'get_contributors',
]);

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const username = Deno.env.get('BIBLIONET_USERNAME');
  const password = Deno.env.get('BIBLIONET_PASSWORD');
  if (!username || !password) {
    console.error('BIBLIONET_USERNAME/BIBLIONET_PASSWORD not set');
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500 });
  }

  let payload: { endpoint?: string; params?: Record<string, string> };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { endpoint, params } = payload;
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return new Response(JSON.stringify({ error: 'Unknown or missing endpoint' }), { status: 400 });
  }

  const body = new URLSearchParams({ username, password, ...(params ?? {}) });

  const biblionetRes = await fetch(`${BIBLIONET_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await biblionetRes.text();
  return new Response(text, {
    status: biblionetRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
});
