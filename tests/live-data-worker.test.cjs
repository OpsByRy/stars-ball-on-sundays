'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '../workers/live-data/worker.mjs')).href);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const BASE = 'a'.repeat(40);

function bucket(objects) {
  const reads = [];
  return {
    reads,
    async get(key) {
      reads.push(key);
      const value = objects[key];
      if (value === undefined) return null;
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      const digest = crypto.createHash('sha256').update(text).digest();
      return { size: Buffer.byteLength(text), checksums: { sha256: value.__badChecksum ? new ArrayBuffer(32) : digest.buffer.slice(digest.byteOffset, digest.byteOffset + 32) },
        body: text, text: async () => text };
    },
  };
}

function setup({ base = BASE, files = { '/data/editions/manifest.json': '{"live":true}' }, pointer = true, extra = {} } = {}) {
  const entries = Object.fromEntries(Object.entries(files).map(([p, body]) => [p, { sha256: sha(body), bytes: Buffer.byteLength(body) }]));
  const layer = { schemaVersion: 'sbos-live-layer-1', baseSourceSHA: BASE, sourceSHA: 'b'.repeat(40), files: entries };
  layer.layerId = sha(JSON.stringify(layer));
  const objects = { ...Object.fromEntries(Object.entries(files).map(([, body]) => ['blobs/' + sha(body), body])), [`layers/${layer.layerId}.json`]: layer, ...extra };
  if (pointer) objects['current.json'] = { layerId: layer.layerId };
  const calls = [];
  const upstream = async (url) => {
    calls.push(url);
    if (url.endsWith('/_sbos-release.json')) return new Response(JSON.stringify({ sourceSHA: base }), { headers: { 'Content-Type': 'application/json' } });
    return new Response('{"pages":true}', { headers: { 'Content-Type': 'application/json' } });
  };
  return { layer, objects, calls, upstream, env: (mode = 'on') => ({ LIVE_LAYER: mode, LIVE_DATA: bucket(objects) }) };
}

test('serves a layer file from R2 and everything else from Pages', async () => {
  const { createHandler } = await load(), s = setup(), handle = createHandler({ upstream: s.upstream }), env = s.env();
  const live = await handle(new Request('https://starsballonsundays.com/data/editions/manifest.json'), env);
  assert.equal(await live.text(), '{"live":true}');
  assert.equal(live.headers.get('X-SBOS-Data-Layer'), s.layer.layerId.slice(0, 12));
  assert.equal(live.headers.get('Content-Type'), 'application/json; charset=utf-8');
  const other = await handle(new Request('https://starsballonsundays.com/data/stat-targets.json'), env);
  assert.equal(await other.text(), '{"pages":true}');
  assert.ok(s.calls.includes('https://sbos-public.pages.dev/data/stat-targets.json'));
});

test('off, a missing pointer, the release receipt and non-data paths pass through or refuse', async () => {
  const { createHandler } = await load();
  let s = setup(), handle = createHandler({ upstream: s.upstream });
  assert.equal(await (await handle(new Request('https://x/data/editions/manifest.json'), s.env('off'))).text(), '{"pages":true}');
  assert.equal(await (await handle(new Request('https://x/_sbos-release.json'), s.env())).text(), JSON.stringify({ sourceSHA: BASE }));
  assert.equal((await handle(new Request('https://x/index.html'), s.env())).status, 404);
  assert.equal((await handle(new Request('https://x/data/../x.json'), s.env())).status, 404);
  assert.equal((await handle(new Request('https://x/data/a.json', { method: 'POST' }), s.env())).status, 405);
  s = setup({ pointer: false }); handle = createHandler({ upstream: s.upstream });
  assert.equal(await (await handle(new Request('https://x/data/editions/manifest.json'), s.env())).text(), '{"pages":true}');
});

test('a layer built on an older deploy is ignored once Pages serves a newer one', async () => {
  const { createHandler } = await load(), s = setup({ base: 'c'.repeat(40) }), handle = createHandler({ upstream: s.upstream });
  assert.equal(await (await handle(new Request('https://x/data/editions/manifest.json'), s.env())).text(), '{"pages":true}');
});

test('a missing or altered blob falls back to Pages', async () => {
  const { createHandler } = await load();
  let s = setup(); delete s.objects['blobs/' + sha('{"live":true}')];
  let handle = createHandler({ upstream: s.upstream });
  assert.equal(await (await handle(new Request('https://x/data/editions/manifest.json'), s.env())).text(), '{"pages":true}');
  s = setup(); s.objects['blobs/' + sha('{"live":true}')] = '{"live":false}';
  handle = createHandler({ upstream: s.upstream });
  assert.equal(await (await handle(new Request('https://x/data/editions/manifest.json'), s.env())).text(), '{"pages":true}');
});

test('the pointer is re-read after a few seconds, the layer and base receipt are cached', async () => {
  const { createHandler } = await load(), s = setup();
  let clock = 0; const handle = createHandler({ upstream: s.upstream, now: () => clock }), env = s.env();
  await handle(new Request('https://x/data/editions/manifest.json'), env);
  await handle(new Request('https://x/data/editions/manifest.json'), env);
  assert.equal(env.LIVE_DATA.reads.filter((k) => k === 'current.json').length, 1);
  clock = 6_000;
  await handle(new Request('https://x/data/editions/manifest.json'), env);
  assert.equal(env.LIVE_DATA.reads.filter((k) => k === 'current.json').length, 2);
  assert.equal(env.LIVE_DATA.reads.filter((k) => k.startsWith('layers/')).length, 1);
  assert.equal(s.calls.filter((u) => u.endsWith('/_sbos-release.json')).length, 1);
});
