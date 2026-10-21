import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check,ShieldCheck } from 'lucide-react';
import { useApp,useResource } from '../api';
import { oauthAuthError } from '../googleAuth';
import type { AuthProviders } from '../types';
import { ErrorNotice,Spinner } from '../ui';
import GoogleMark from './GoogleMark';
import GitHubMark from './GitHubMark';

const providersToConnect=[{id:'google',name:'Google',Mark:GoogleMark},{id:'github',name:'GitHub',Mark:GitHubMark}] as const;

export default function AccountConnections(){
  const {session}=useApp();
  const [params]=useSearchParams(),[redirecting,setRedirecting]=useState<'google'|'github'|null>(null);
  const {data:providers,loading,error}=useResource<AuthProviders>('/api/auth/providers',{google:false,github:false});
  return <>
    <ErrorNotice message={oauthAuthError(params.get('oauth_error'),params.get('oauth_provider'))}/>
    {providersToConnect.map(({id,name,Mark})=>{
      const linked=id==='google'?session?.user?.google_linked:session?.user?.github_linked;
      return <section key={id} className="panel google-account-panel" id={id==='google'?'account':'github-account'}>
        <div className="google-account-heading"><Mark size={21}/><h3>{name} sign-in</h3>{linked===true&&<span className="badge green"><Check size={11}/>Connected</span>}</div>
        {params.get(id)==='linked'&&linked===true&&<p className="google-link-confirmation" role="status"><ShieldCheck size={14}/>{name} is connected to your account.</p>}
        <p>{linked===true?`You can sign in with your connected ${name} account. Your workspace and projects stay together.`:`Connect the ${name} account with the same verified email as your Traqiva account. Your existing workspace stays intact.`}</p>
        {linked!==true&&<button className="button secondary full-width" disabled={loading||!providers[id]||linked!==false||!!redirecting} aria-busy={redirecting===id} onClick={()=>{
          if(loading||!providers[id]||linked!==false||redirecting)return;
          setRedirecting(id);window.location.assign(`/api/auth/${id}?intent=link`);
        }}>{redirecting===id?<Spinner/>:<Mark size={15}/>}Connect {name} account</button>}
        {error?<small>{name} availability could not be checked. Your email account is unaffected.</small>:loading?<small>Checking {name} availability…</small>:!providers[id]?<small>{name} sign-in is not configured.</small>:linked===undefined?<small>Connection status is unavailable. Refresh your session before connecting.</small>:null}
      </section>;
    })}
  </>;
}
