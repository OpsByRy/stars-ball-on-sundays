const test=require('node:test'),assert=require('node:assert/strict');
const {gzipSync}=require('node:zlib'),{createHash}=require('node:crypto');
const transport=require('../assets/json-transport.js');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function wire(raw,extra={}){
  const compressed=gzipSync(raw);
  return JSON.stringify({schemaVersion:'sbos-json-gzip-1',encoding:'gzip',sourceBytes:raw.length,sourceSHA256:hash(raw),compressedBytes:compressed.length,compressedSHA256:hash(compressed),payload:compressed.toString('base64'),...extra})+'\n';
}
const raw=Buffer.from('{"id":"saved-original","number":1.0000000000000000123,"exponent":1e-007,"name":"Jokić","quote":-215,"capturedAt":"2026-11-18T17:00:30.000Z","postedAt":"2026-11-18T17:10:47.833043Z"}\n');

test('ordinary published responses stay byte-identical, including tiny body chunks',async()=>{
  let at=0;const response=new Response(new ReadableStream({pull(c){if(at===raw.length)c.close();else c.enqueue(raw.subarray(at,++at));}}),{headers:{'Content-Type':'application/json'}});
  assert.deepEqual(Buffer.from(await (await transport.decodeResponse(response)).arrayBuffer()),raw);
});
test('browser reconstruction preserves exact literal bytes, identities and clocks',async()=>{
  const decoded=await transport.decodeResponse(new Response(wire(raw),{headers:{'Content-Length':'123','ETag':'wire','Content-Type':'application/json'}}));
  assert.equal(decoded.headers.get('Content-Length'),null);assert.equal(decoded.headers.get('ETag'),null);
  assert.equal(decoded.headers.get('X-SBOS-JSON-Source-SHA256'),hash(raw));
  assert.deepEqual(Buffer.from(await decoded.arrayBuffer()),raw);
  assert.deepEqual(await transport.readJSON(new Response(wire(raw))),JSON.parse(raw));
});
test('tampered digests, lengths, schemas, base64 and gzip fail closed',async()=>{
  for(const extra of [{sourceSHA256:'0'.repeat(64)},{compressedSHA256:'0'.repeat(64)},{sourceBytes:raw.length-1},{sourceBytes:raw.length+1},{sourceBytes:513*1024*1024},{unexpected:true},{payload:'???'},{encoding:'other'}]){
    await assert.rejects(async()=>{const response=await transport.decodeResponse(new Response(wire(raw,extra)));await response.arrayBuffer();});
  }
  const body=JSON.parse(wire(raw)),bad=Buffer.from(body.payload,'base64');bad[bad.length-5]^=1;
  body.payload=bad.toString('base64');body.compressedSHA256=hash(bad);
  await assert.rejects(async()=>{const response=await transport.decodeResponse(new Response(JSON.stringify(body)));await response.text();});
});
test('Worker path requires native streaming integrity and propagates late hash failure',async()=>{
  const previous=globalThis.crypto.DigestStream;
  class DigestStream extends WritableStream{
    constructor(){let resolve,reject;const digest=new Promise((a,b)=>{resolve=a;reject=b;}),state=createHash('sha256');
      super({write(bytes){state.update(bytes);},close(){resolve(Uint8Array.from(state.digest()).buffer);},abort(error){reject(error);}});this.digest=digest;}
  }
  try{
    delete globalThis.crypto.DigestStream;
    await assert.rejects(()=>transport.decodeResponse(new Response(wire(raw)),{requireStreamingDigest:true}),/Streaming JSON integrity unavailable/);
    globalThis.crypto.DigestStream=DigestStream;
    const response=await transport.decodeResponse(new Response(wire(raw)),{requireStreamingDigest:true});
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),raw);
    const altered=await transport.decodeResponse(new Response(wire(raw,{sourceSHA256:'0'.repeat(64)})),{requireStreamingDigest:true});
    await assert.rejects(()=>altered.json(),/digest differs/);
  }finally{if(previous)globalThis.crypto.DigestStream=previous;else delete globalThis.crypto.DigestStream;}
});
