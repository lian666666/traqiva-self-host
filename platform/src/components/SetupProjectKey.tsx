import { useState } from 'react';
import { Check,KeyRound,Plus } from 'lucide-react';
import { api,json } from '../api';
import { CopyButton,ErrorNotice,Spinner } from '../ui';

export default function SetupProjectKey({projectId}:{projectId:string}){
  const [name,setName]=useState('Local agent setup'),[key,setKey]=useState(''),[created,setCreated]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function create(){if(busy||!name.trim())return;setBusy(true);setError('');try{const result=await api<{key:string}>('/api/keys',json({project_id:projectId,name:name.trim()}));setKey(result.key);setCreated(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="setup-key-section"><div className="setup-key-heading"><KeyRound size={18}/><div><h3>{created?'Save your project key':'Create a project key'}</h3><p>{created?'The full key is shown once. Save it privately before hiding it.':'Use a scoped key to connect this project. Already have one? Keep using it.'}</p></div></div>{key?<><div className="setup-key-secret"><code>{key}</code><CopyButton value={key} label="Copy key"/></div><button className="button secondary compact" onClick={()=>setKey('')}><Check size={14}/>I’ve saved my key</button></>:created?<p className="setup-key-saved"><Check size={14}/>Key hidden. Use your saved copy in a private local terminal.</p>:<div className="setup-key-create"><label className="field">Key name<input value={name} onChange={e=>setName(e.target.value)} maxLength={100} placeholder="Local agent setup"/></label><button className="button secondary" disabled={busy||!name.trim()} onClick={()=>void create()}>{busy?<Spinner/>:<Plus size={15}/>}Create project key</button></div>}<ErrorNotice message={error}/><p className="setup-key-note">Never paste this key into an AI chat or source code. Commands and setup prompts below contain a placeholder, never your key.</p></section>;
}
