import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check,ShieldCheck } from 'lucide-react';
import { useApp,useResource } from '../api';
import { googleAuthError } from '../googleAuth';
import { ErrorNotice,Spinner } from '../ui';
import GoogleMark from './GoogleMark';

export default function GoogleAccountConnection(){
  const {session}=useApp();const [params]=useSearchParams(),[redirecting,setRedirecting]=useState(false);
  const {data:providers,loading,error}=useResource<{google:boolean}>('/api/auth/providers',{google:false});
  const linked=session?.user?.google_linked;
  return <section className="panel google-account-panel" id="account"><div className="google-account-heading"><GoogleMark size={21}/><h3>Google sign-in</h3>{linked===true&&<span className="badge green"><Check size={11}/>Connected</span>}</div><ErrorNotice message={googleAuthError(params.get('oauth_error'))}/>{params.get('google')==='linked'&&linked===true&&<p className="google-link-confirmation" role="status"><ShieldCheck size={14}/>Google is connected to your account.</p>}<p>{linked===true?'You can sign in with your connected Google account. Your workspace and projects stay together.':'Connect the Google account with the same verified email as your Traqiva account. Your existing workspace stays intact.'}</p>{linked!==true&&<button className="button secondary full-width" disabled={loading||!providers.google||linked!==false||redirecting} onClick={()=>{setRedirecting(true);window.location.assign('/api/auth/google?intent=link');}}>{redirecting?<Spinner/>:<GoogleMark size={15}/>}Connect Google account</button>}{error?<small>Google availability could not be checked. Your email account is unaffected.</small>:loading?<small>Checking Google availability…</small>:!providers.google?<small>Google sign-in is not configured.</small>:linked===undefined?<small>Connection status is unavailable. Refresh your session before connecting.</small>:null}</section>;
}
