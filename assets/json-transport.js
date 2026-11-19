/* Lossless immutable-edition transport. No quote, forecast or result is rewritten. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SBOS_JSON=api;})(globalThis,function(){
  'use strict';
  const SCHEMA='sbos-json-gzip-1',PREFIX='{"schemaVersion":"'+SCHEMA+'",';
  const MAX_WIRE=8*1024*1024,MAX_SOURCE=512*1024*1024;
  const fields=['compressedBytes','compressedSHA256','encoding','payload','schemaVersion','sourceBytes','sourceSHA256'];
  const fail=(ok,message)=>{if(!ok)throw Error(message);};
  const hex=buffer=>Array.from(new Uint8Array(buffer),n=>n.toString(16).padStart(2,'0')).join('');
  const hash=async bytes=>hex(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  function replay(reader,first){
    let index=0;
    return new ReadableStream({
      async pull(controller){
        try{if(index<first.length){controller.enqueue(first[index++]);return;}const next=await reader.read();if(next.done)controller.close();else controller.enqueue(next.value);}
        catch(error){controller.error(error);}
      },cancel(reason){return reader.cancel(reason);}
    });
  }
  async function envelope(reader,first){
    const chunks=first.slice();let length=chunks.reduce((n,b)=>n+b.byteLength,0);
    try{while(true){fail(length<=MAX_WIRE,'JSON transport exceeds wire bound');const next=await reader.read();if(next.done)break;length+=next.value.byteLength;chunks.push(next.value);}fail(length<=MAX_WIRE,'JSON transport exceeds wire bound');}
    catch(error){await reader.cancel(error).catch(()=>{});throw error;}
    const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
    const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    fail(body&&JSON.stringify(Object.keys(body).sort())===JSON.stringify(fields)&&body.schemaVersion===SCHEMA&&body.encoding==='gzip','Invalid JSON transport schema');
    fail(Number.isSafeInteger(body.sourceBytes)&&body.sourceBytes>0&&body.sourceBytes<=MAX_SOURCE,'Invalid JSON source bound');
    fail(Number.isSafeInteger(body.compressedBytes)&&body.compressedBytes>0&&body.compressedBytes<=MAX_WIRE,'Invalid compressed JSON bound');
    fail(typeof body.sourceSHA256==='string'&&typeof body.compressedSHA256==='string'&&/^[0-9a-f]{64}$/.test(body.sourceSHA256)&&/^[0-9a-f]{64}$/.test(body.compressedSHA256),'Invalid JSON transport digest');
    fail(typeof body.payload==='string'&&body.payload.length===4*Math.ceil(body.compressedBytes/3)&&/^[A-Za-z0-9+/]*={0,2}$/.test(body.payload),'Invalid compressed JSON payload');
    const binary=atob(body.payload),compressed=Uint8Array.from(binary,c=>c.charCodeAt(0));
    fail(compressed.byteLength===body.compressedBytes&&btoa(binary)===body.payload&&await hash(compressed)===body.compressedSHA256,'Compressed JSON digest differs');
    return {body,compressed};
  }
  function counted(stream,expected){
    let length=0;
    return stream.pipeThrough(new TransformStream({transform(bytes,controller){length+=bytes.byteLength;fail(length<=expected,'JSON source exceeds declared size');controller.enqueue(bytes);},flush(){fail(length===expected,'JSON source size differs');}}));
  }
  function verifiedStream(stream,body){
    const digest=new globalThis.crypto.DigestStream('SHA-256'),writer=digest.getWriter(),reader=stream.getReader();
    const done=digest.digest;done.catch(()=>{});
    async function abort(reason){await Promise.allSettled([reader.cancel(reason),writer.abort(reason)]);}
    return new ReadableStream({
      async pull(controller){
        try{const next=await reader.read();if(next.done){await writer.close();fail(hex(await done)===body.sourceSHA256,'Reconstructed JSON digest differs');controller.close();}
          else{await writer.write(next.value);controller.enqueue(next.value);}}
        catch(error){await abort(error);controller.error(error);}
      },cancel(reason){return abort(reason);}
    });
  }
  async function decodeResponse(response,{requireStreamingDigest=false}={}){
    if(!response.ok||!response.body)return response;
    const reader=response.body.getReader(),first=[];let size=0,ended=false;
    while(size<PREFIX.length){const next=await reader.read();if(next.done){ended=true;break;}first.push(next.value);size+=next.value.byteLength;}
    const prefix=new Uint8Array(Math.min(size,PREFIX.length));let at=0;
    for(const chunk of first){const part=chunk.subarray(0,prefix.length-at);prefix.set(part,at);at+=part.byteLength;if(at===prefix.length)break;}
    if(ended||new TextDecoder().decode(prefix)!==PREFIX)return new Response(replay(reader,first),response);
    const {body,compressed}=await envelope(reader,first);
    fail(typeof DecompressionStream==='function','JSON decompression unavailable');
    fail(!requireStreamingDigest||typeof globalThis.crypto?.DigestStream==='function','Streaming JSON integrity unavailable');
    let stream=counted(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),body.sourceBytes);
    if(typeof globalThis.crypto?.DigestStream==='function')stream=verifiedStream(stream,body);
    else{
      fail(!requireStreamingDigest,'Streaming JSON integrity unavailable');
      const bytes=await new Response(stream).arrayBuffer();fail(await hash(bytes)===body.sourceSHA256,'Reconstructed JSON digest differs');
      stream=new Blob([bytes]).stream();
    }
    const headers=new Headers(response.headers);
    for(const name of ['Content-Length','Content-Encoding','ETag'])headers.delete(name);
    headers.set('Content-Type','application/json; charset=utf-8');headers.set('X-SBOS-JSON-Source-SHA256',body.sourceSHA256);
    return new Response(stream,{status:response.status,statusText:response.statusText,headers});
  }
  async function readJSON(response){return (await decodeResponse(response)).json();}
  return Object.freeze({decodeResponse,readJSON});
});
