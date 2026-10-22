import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setControl } from '../lib/controls.mjs';
const bin=fileURLToPath(new URL('../bin/traqiva.mjs',import.meta.url));
async function fixture(t){const home=await mkdtemp(join(tmpdir(),'traqiva-six-mcp-'));t.after(()=>rm(home,{recursive:true,force:true}));return home;}
async function mcp(home,requests){return await new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[bin,'mcp'],{env:{...process.env,TRAQIVA_HOME:home},windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',error='';
 child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);child.on('error',reject);child.on('exit',code=>{if(code!==0)return reject(new Error(error));try{resolve(output.trim().split('\n').map(line=>JSON.parse(line)));}catch(e){reject(e);}});
 child.stdin.end([{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}},...requests].map(row=>JSON.stringify(row)).join('\n')+'\n');
});}
const call=(id,name,args={})=>({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
test('MCP actually enforces disabled controls while retaining source recovery',async t=>{
 const home=await fixture(t);for(const name of ['read-less','blocks','browse'])await setControl(name,false,{home});await setControl('say-less',true,{home});
 const result=await mcp(home,[{jsonrpc:'2.0',id:2,method:'tools/list'},call(3,'traqiva_compress',{input:'test'})]);
 assert.match(result[0].result.instructions,/Answer concisely/);
 const names=result[1].result.tools.map(tool=>tool.name);assert.equal(names.includes('traqiva_compress'),false);assert.equal(names.includes('traqiva_block_save'),false);assert.equal(names.includes('traqiva_browse'),false);assert.ok(names.includes('traqiva_retrieve'));assert.ok(names.includes('traqiva_browse_recover'));
 assert.equal(result[2].result.isError,true);assert.match(result[2].result.content[0].text,/read-less is disabled/i);
});
test('MCP blocks save and retrieve actual exact script content without executing it',async t=>{
 const home=await fixture(t),content='console.log("must not execute inside MCP");\n';
 const first=await mcp(home,[call(2,'traqiva_block_save',{name:'Reusable test',content,language:'javascript'})]);
 assert.equal(first[1].result.isError,false);const saved=JSON.parse(first[1].result.content[0].text);assert.ok(saved.id);
 const second=await mcp(home,[call(2,'traqiva_block_get',{id:saved.id}),call(3,'traqiva_block_search',{query:'Reusable'})]);
 assert.equal(JSON.parse(second[1].result.content[0].text).content,content);assert.equal(JSON.parse(second[2].result.content[0].text).total,1);
});
