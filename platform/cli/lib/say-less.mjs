export const CONCISE_INSTRUCTION='Answer concisely: give the result first and remove repetition or filler. Preserve every technical fact, qualification, source, code detail and requested detail needed to answer correctly. Respect an explicit request for a detailed or longer answer. Do not truncate code, omit required reasoning, or claim unmeasured savings.';
import { jsonMember } from './json-members.mjs';
export function applySayLessRaw(raw,path){
 const original=JSON.parse(raw),changed=applySayLess(original,path,true);
 if(!changed.applied)return raw;
 const field=path==='/v1/responses'?'instructions':path==='/v1/messages'?'system':'messages';
 let value;
 if(field==='messages'){
  const source=jsonMember(raw,field).trim();
  value='['+JSON.stringify(changed.body.messages[0])+(original.messages.length?',':'')+source.slice(1);
 }else if(field==='system'&&Array.isArray(original.system)){
  const source=jsonMember(raw,field).trim();
  value=source.slice(0,-1)+(original.system.length?',':'')+JSON.stringify(changed.body.system.at(-1))+']';
 }else value=JSON.stringify(changed.body[field]);
 return jsonMember(raw,field,value);
}
export function applySayLess(body,path,enabled){
 if(!enabled)return {body,applied:false};
 if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Say Less requires a JSON request object.');
 const result=structuredClone(body);
 if(path==='/v1/responses'){
  if(result.instructions!==undefined&&typeof result.instructions!=='string')throw new Error('Say Less cannot safely extend these Responses instructions.');
  if(result.instructions?.includes(CONCISE_INSTRUCTION))return {body,applied:false};
  result.instructions=result.instructions?`${result.instructions}\n\n${CONCISE_INSTRUCTION}`:CONCISE_INSTRUCTION;
 }else if(path==='/v1/messages'){
  if(typeof result.system==='string'){if(result.system.includes(CONCISE_INSTRUCTION))return {body,applied:false};result.system+=`\n\n${CONCISE_INSTRUCTION}`;}
  else if(result.system===undefined)result.system=CONCISE_INSTRUCTION;
  else if(Array.isArray(result.system)){if(result.system.some(block=>block?.type==='text'&&block.text?.includes(CONCISE_INSTRUCTION)))return {body,applied:false};result.system.push({type:'text',text:CONCISE_INSTRUCTION});}
  else throw new Error('Say Less cannot safely extend these Anthropic system instructions.');
 }else if(path==='/v1/chat/completions'){
  if(!Array.isArray(result.messages))throw new Error('Say Less requires a chat messages array.');
  if(result.messages.some(message=>['system','developer'].includes(message?.role)&&typeof message.content==='string'&&message.content.includes(CONCISE_INSTRUCTION)))return {body,applied:false};
  result.messages.unshift({role:'system',content:CONCISE_INSTRUCTION});
 }else throw new Error('Say Less does not support this provider route.');
 return {body:result,applied:true};
}
