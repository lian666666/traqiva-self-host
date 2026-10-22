import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../lib/say-less.mjs').catch(()=>({}));

test('style injection preserves unrelated JSON number literals and original message/tool bytes',()=>{
 const source='{ "model":"mine", "input":[9007199254740993,1e100], "instructions":"Cite sources" }';
 assert.equal(typeof module.applySayLessRaw,'function');
 const changed=module.applySayLessRaw(source,'/v1/responses');
 assert.ok(changed.includes('"input":[9007199254740993,1e100]'));
 assert.match(JSON.parse(changed).instructions,/Cite sources/);
 const chat='{ "model":"mine", "messages":[{"role":"user","content":[{"type":"text","text":"a } ] \\" b"}],"n":9007199254740993}],"tools":[{"schema":{"number":1e100}}] }';
 const chatChanged=module.applySayLessRaw(chat,'/v1/chat/completions');
 assert.ok(chatChanged.includes('"n":9007199254740993'));
 assert.ok(chatChanged.includes('"tools":[{"schema":{"number":1e100}}]'));
 assert.equal(JSON.parse(chatChanged).messages.length,2);
});
test('Say Less is opt-in and never mutates the original request or its model',()=>{
 assert.equal(typeof module.applySayLess,'function','Say Less is not implemented.');
 const body={model:'user-model',messages:[{role:'system',content:'Use Spanish'},{role:'user',content:'Explain in detail'}]};
 const source=JSON.stringify(body);assert.equal(module.applySayLess(body,'/v1/chat/completions',false).body,body);
 const result=module.applySayLess(body,'/v1/chat/completions',true);assert.equal(result.applied,true);assert.equal(result.body.model,'user-model');assert.equal(JSON.stringify(body),source);
 assert.deepEqual(result.body.messages.slice(1),body.messages);assert.match(result.body.messages[0].content,/concise/i);assert.match(result.body.messages[0].content,/requested detail/i);
});
test('Responses instructions and Anthropic system blocks are retained with no duplicate style prompt',()=>{
 assert.equal(typeof module.applySayLess,'function');
 const response=module.applySayLess({model:'a',instructions:'Keep all citations',input:'Hello'},'/v1/responses',true);
 assert.match(response.body.instructions,/Keep all citations/);
 const again=module.applySayLess(response.body,'/v1/responses',true);assert.equal(again.body.instructions,response.body.instructions);
 const system=[{type:'text',text:'Use Spanish',cache_control:{type:'ephemeral'}}];
 const anthropic=module.applySayLess({model:'b',system,messages:[]},'/v1/messages',true);
 assert.deepEqual(anthropic.body.system[0],system[0]);assert.equal(anthropic.body.system.length,2);
 assert.equal(system.length,1);
});
