import { useEffect,useState } from 'react';
import { ArrowRight,ShieldCheck } from 'lucide-react';
import { api,json,useApp } from '../api';
import { ErrorNotice,Modal,Spinner } from '../ui';

export default function SetupConsent({version,onClose}:{version:string;onClose:()=>void}){
  const {reload}=useApp();const [accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setAccepted(false);},[version]);
  async function accept(){if(!accepted||busy)return;setBusy(true);setError('');try{await api('/api/consent',json({version,accepted:true}));await reload();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Modal title="Before you continue" onClose={()=>{if(!busy)onClose();}}><div className="setup-consent-intro"><span><ShieldCheck size={25}/></span><h3>Your workspace. Clear terms.</h3><p>Your prompts are not used to train Traqiva models. Requests you record are stored in your workspace under its retention setting. Your model provider’s own policy still applies.</p></div><div className="setup-policy-links"><a href="/terms" target="_blank" rel="noreferrer">Terms of service</a><a href="/privacy" target="_blank" rel="noreferrer">Privacy policy</a><a href="/data" target="_blank" rel="noreferrer">Data & retention</a></div><label className="setup-consent-checkbox"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} disabled={busy}/><span>I agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms of service</a> and acknowledge the <a href="/privacy" target="_blank" rel="noreferrer">Privacy policy</a> and <a href="/data" target="_blank" rel="noreferrer">data practices</a>.</span></label><ErrorNotice message={error}/><button className="button primary full-width" disabled={!accepted||busy} onClick={()=>void accept()}>{busy?<Spinner/>:<>Accept and continue<ArrowRight size={15}/></>}</button><p className="setup-consent-version">Version {version} · Acceptance is saved to your account.</p></Modal>;
}
