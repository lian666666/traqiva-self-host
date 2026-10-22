import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setControl } from '../lib/controls.mjs';
const bin=fileURLToPath(new URL('../bin/traqiva.mjs',import.meta.url));
test('long-lived local bridge adds Say Less only when enabled and keeps provider SSE exact',async t=>{
 const home=await mkdtemp(join(tmpdir(),'traqiva-style-proxy-'));const requests=[];
 const server=createServer(async(req,res)=>{
  if(req.url==='/api/connection'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({connected:true,project:{id:'test-project',name:'Fixture'}}));return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);requests.push(Buffer.concat(chunks).toString());
  res.writeHead(200,{'content-type':'text/event-stream','x-traqiva-routing-tier':'small'});res.end('data: {"ok":true}\n\ndata: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 await writeFile(join(home,'config.json'),JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,project:'test-project',key:'synthetic-project-key'}));
 const child=spawn(process.execPath,[bin,'serve','--port','0'],{env:{...process.env,TRAQIVA_HOME:home},stdio:['ignore','pipe','pipe'],windowsHide:true});
 t.after(async()=>{child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(home,{recursive:true,force:true});});
 const address=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Local bridge startup timed out')),5000);child.stderr.on('data',chunk=>{output+=chunk;const line=output.split('\n').find(line=>line.includes('"listening"'));if(line){clearTimeout(timer);resolve(JSON.parse(line).listening);}});child.on('error',reject);});
 const original='{ "model": "my-model", "messages": [{ "role": "user", "content": "Keep the facts" }] }';
 const send=()=>fetch(address+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer synthetic-provider-key','content-type':'application/json'},body:original});
 let response=await send();assert.equal(await response.text(),'data: {"ok":true}\n\ndata: [DONE]\n\n');assert.equal(requests.at(-1),original);
 await setControl('say-less',true,{home});response=await send();assert.equal(response.status,200);assert.equal(response.headers.get('x-traqiva-routing-tier'),'small');assert.equal(await response.text(),'data: {"ok":true}\n\ndata: [DONE]\n\n');
 const changed=JSON.parse(requests.at(-1));assert.equal(changed.model,'my-model');assert.match(changed.messages[0].content,/Answer concisely/);assert.equal(changed.messages[1].content,'Keep the facts');
 const count=requests.length;
 const malformed=await fetch(address+'/v1/responses',{method:'POST',headers:{authorization:'Bearer synthetic-provider-key','content-type':'application/json'},body:Buffer.from('7b226d6f64656c223a226578706c69636974222c22696e707574223a22ff227d','hex')});
 assert.equal(malformed.status,400);assert.equal(requests.length,count,'Malformed UTF-8 must not be rewritten or forwarded by Say Less.');
 await setControl('say-less',false,{home});await (await send()).text();assert.equal(requests.at(-1),original);
});
