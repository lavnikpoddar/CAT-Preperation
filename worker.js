// Password gate for the static site. Set the secret SITE_PASSWORD (Cloudflare dashboard, Workers, Settings,
// Variables and Secrets) to turn it on. Any username works; only the password is checked.
// Until the secret exists the site stays open, but /private/ (copied reading texts) is refused outright.
const enc = new TextEncoder();
async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0; for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
export default {
  async fetch(request, env) {
    const pw = env.SITE_PASSWORD;
    const priv = new URL(request.url).pathname.startsWith('/private/');
    if (!pw) {
      if (priv) return new Response('Locked: set the SITE_PASSWORD secret to serve private files.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
      return env.ASSETS.fetch(request);
    }
    const h = request.headers.get('Authorization') || '';
    let given = '';
    if (h.startsWith('Basic ')) {
      try { const raw = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6)), c => c.charCodeAt(0))); given = raw.slice(raw.indexOf(':') + 1); } catch (e) { /* bad header */ }
    }
    if (!(await same(given, pw))) {
      return new Response('Password needed.', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="CAT Prep", charset="UTF-8"', 'Cache-Control': 'no-store' } });
    }
    const res = await env.ASSETS.fetch(request);
    if (!priv) return res;
    const out = new Response(res.body, res); out.headers.set('Cache-Control', 'private, no-store'); return out;
  },
};
