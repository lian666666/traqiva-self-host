import { mkdir,readFile,writeFile,rename,unlink,rmdir,lstat } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { configHome } from './client.mjs';

const defaults=Object.freeze({'say-less':false,'read-less':true,blocks:true,browse:true});
export const CONTROL_NAMES=Object.freeze(Object.keys(defaults));
export async function readControls({home=configHome()}={}){
 const file=join(resolve(home),'controls.json');let text;
 try{const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new Error('Unexpected local controls settings file.');text=await readFile(file,'utf8');}
 catch(error){if(error.code==='ENOENT')return {schema:1,features:{...defaults},updated_at:null};throw error;}
 let value;try{value=JSON.parse(text);}catch{throw new Error('Local controls settings are invalid; preserve and review controls.json.');}
 if(value?.schema!==1||!value.features||typeof value.features!=='object'||Array.isArray(value.features)||Object.keys(value.features).length!==CONTROL_NAMES.length||CONTROL_NAMES.some(name=>typeof value.features[name]!=='boolean')||Object.keys(value).some(key=>!['schema','features','updated_at'].includes(key)))throw new Error('Local controls settings are invalid or from an unsupported version.');
 return value;
}
export async function setControl(name,enabled,{home=configHome()}={}){
 if(!CONTROL_NAMES.includes(name)||typeof enabled!=='boolean')throw new Error('Use a supported control name and on/off value.');
 home=resolve(home);await mkdir(home,{recursive:true,mode:0o700});const lock=join(home,'.controls.lock');let owned=false;
 for(let attempt=0;attempt<50;attempt++){try{await mkdir(lock,{mode:0o700});owned=true;break;}catch(error){if(error.code!=='EEXIST')throw error;await delay(20);}}
 if(!owned)throw new Error('Local controls settings are busy; retry after the other update completes.');
 const temporary=join(home,`controls.${randomUUID()}.tmp`);
 try{const current=await readControls({home});const value={schema:1,features:{...current.features,[name]:enabled},updated_at:new Date().toISOString()};await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,join(home,'controls.json'));return value;}
 finally{await unlink(temporary).catch(()=>{});await rmdir(lock);}
}
export async function requireControl(name){if(!CONTROL_NAMES.includes(name))throw new Error('Unknown local control.');const controls=await readControls();if(!controls.features[name])throw new Error(`${name} is disabled. Enable it with traqiva controls set ${name} on.`);return controls;}
