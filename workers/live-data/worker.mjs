// sbos-live-data: the site server's published-data source (its PUBLISHED_DATA service binding).
//
// Without this Worker the site server fetches /data/*.json from the sbos-public Pages deploy.
// With it, a file listed in the current live layer (R2 bucket sbos-public-data, written by the
// public repo's live.yml fast lane) is served from R2; everything else is fetched from Pages
// exactly as before. The layer is used only while its base is the deploy Pages is serving, so a
// newer full deploy is never overlaid with older files.
//
// LIVE_LAYER = "on" serves the layer; anything else is a plain pass-through to Pages (kill switch).
// Any R2 problem (missing pointer, layer or blob, size or checksum mismatch) falls back to Pages.

export const ORIGIN = 'https://sbos-public.pages.dev';
const POINTER_TTL_MS = 5_000;
const RECEIPT_TTL_MS = 30_000;

export function dataPath(path) {
  return (path === '/_sbos-release.json' || path === '/assets/parlay-withdrawals.json' || /^\/data\/[a-zA-Z0-9_/-]+\.json$/.test(path))
    && !path.split('/').includes('..');
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function createHandler({ now = () => Date.now(), upstream = (url, init) => fetch(url, init) } = {}) {
  let pointer = { at: -Infinity, value: null };
  let receipt = { at: -Infinity, value: null };
  const layers = new Map();

  async function readJSON(bucket, key) {
    const object = await bucket.get(key);
    return object ? JSON.parse(await object.text()) : null;
  }

  async function liveBase() {
    if (now() - receipt.at > RECEIPT_TTL_MS) {
      const response = await upstream(ORIGIN + '/_sbos-release.json', { headers: { Accept: 'application/json' }, redirect: 'manual', cf: { cacheTtl: 0 } });
      if (!response.ok) throw new Error('base receipt ' + response.status);
      receipt = { at: now(), value: (await response.json()).sourceSHA };
    }
    return receipt.value;
  }

  async function currentLayer(env) {
    if (now() - pointer.at > POINTER_TTL_MS) pointer = { at: now(), value: await readJSON(env.LIVE_DATA, 'current.json') };
    const id = pointer.value?.layerId;
    if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
    if (!layers.has(id)) {
      const layer = await readJSON(env.LIVE_DATA, `layers/${id}.json`);
      if (!layer || layer.schemaVersion !== 'sbos-live-layer-1' || layer.layerId !== id) throw new Error('bad layer ' + id);
      layers.set(id, layer);
      if (layers.size > 8) layers.delete(layers.keys().next().value);
    }
    const layer = layers.get(id);
    return layer.baseSourceSHA === await liveBase() ? layer : null;
  }

  return async function handle(request, env) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    if (!dataPath(url.pathname)) return new Response('Not found', { status: 404 });
    const fromPages = () => upstream(ORIGIN + url.pathname + url.search, {
      method: request.method, headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(25_000), cf: { cacheTtl: 0 },
    });
    if (env.LIVE_LAYER !== 'on' || !env.LIVE_DATA || url.pathname === '/_sbos-release.json') return fromPages();
    try {
      const layer = await currentLayer(env);
      const entry = layer?.files?.[url.pathname];
      if (!entry) return fromPages();
      const object = await env.LIVE_DATA.get('blobs/' + entry.sha256);
      const stored = object?.checksums?.sha256 ? hex(object.checksums.sha256) : null;
      if (!object || object.size !== entry.bytes || stored !== entry.sha256) throw new Error('blob check failed ' + url.pathname);
      return new Response(request.method === 'HEAD' ? null : object.body, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ETag: `"${entry.sha256}"`, 'X-SBOS-Data-Layer': layer.layerId.slice(0, 12) },
      });
    } catch (error) {
      console.warn(JSON.stringify({ event: 'sbos_live_layer_fallback', path: url.pathname, error: String(error?.message || error) }));
      return fromPages();
    }
  };
}

const handle = createHandler();
export default { fetch: (request, env) => handle(request, env) };
