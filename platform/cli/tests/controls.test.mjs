import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const module = await import('../lib/controls.mjs').catch(()=>({}));
async function fixture(t){const home=await mkdtemp(join(tmpdir(),'traqiva-controls-'));t.after(()=>rm(home,{recursive:true,force:true}));return {home};}
test('local controls read defaults without installing or writing anything',async t=>{
 assert.equal(typeof module.readControls,'function','Local controls are not implemented.');
 const options=await fixture(t);const value=await module.readControls(options);
 assert.deepEqual(value.features,{'say-less':false,'read-less':true,blocks:true,browse:true});
 assert.deepEqual(await readdir(options.home),[]);
});
test('independent switches persist and preserve a concurrent different switch',async t=>{
 assert.equal(typeof module.setControl,'function');const options=await fixture(t);
 await Promise.all([module.setControl('say-less',true,options),module.setControl('browse',false,options)]);
 const value=await module.readControls(options);assert.equal(value.features['say-less'],true);assert.equal(value.features.browse,false);assert.equal(value.features['read-less'],true);
 const stored=JSON.parse(await readFile(join(options.home,'controls.json'),'utf8'));assert.equal(stored.schema,1);
});
test('invalid names or stored settings fail closed without overwriting',async t=>{
 assert.equal(typeof module.setControl,'function');const options=await fixture(t);
 await assert.rejects(module.setControl('../api-key',true,options),/control|feature/i);
 await writeFile(join(options.home,'controls.json'),'broken JSON');
 await assert.rejects(module.readControls(options),/settings|controls/i);
 await assert.rejects(module.setControl('blocks',false,options),/settings|controls/i);
 assert.equal(await readFile(join(options.home,'controls.json'),'utf8'),'broken JSON');
});
