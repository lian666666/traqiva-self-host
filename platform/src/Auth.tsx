import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Mail, ShieldCheck } from 'lucide-react';
import { api,json,useApp,useResource } from './api';
import { ErrorNotice, Logo, Spinner } from './ui';
import type { AuthProviders,Session } from './types';
import { oauthAuthError } from './googleAuth';
import GoogleMark from './components/GoogleMark';
import GitHubMark from './components/GitHubMark';
import { signedInDestination } from './setupState';

export default function Auth({signup=false}:{signup?:boolean}){
  const {session,reload,loading}=useApp(),navigate=useNavigate();
  const [params]=useSearchParams(),oauthCode=params.get('oauth_error');
  const [email,setEmail]=useState(''),[name,setName]=useState(''),[password,setPassword]=useState('');
  const [emailMode,setEmailMode]=useState(oauthCode==='email_signin_required');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [redirecting,setRedirecting]=useState<'google'|'github'|null>(null);
  const {data:providers,loading:providersLoading,error:providersError}=useResource<AuthProviders>('/api/auth/providers',{google:false,github:false});
  useEffect(()=>{document.title=signup?'Create account — Traqiva':'Sign in — Traqiva';},[signup]);
  useEffect(()=>{if(oauthCode==='email_signin_required')setEmailMode(true);},[oauthCode]);
  if(!loading&&session?.user)return <Navigate to={signedInDestination(session,oauthCode,params.get('oauth_provider'))} replace/>;

  function continueWith(provider:'google'|'github'){
    if(providersLoading||!providers[provider]||redirecting||busy)return;
    setRedirecting(provider);
    window.location.assign(`/api/auth/${provider}?intent=${signup?'signup':'login'}`);
  }
  async function submit(e:FormEvent){
    e.preventDefault();if(busy||redirecting)return;
    setBusy(true);setError('');
    try{const result=await api<Session>(`/api/auth/${signup?'register':'login'}`,json({name,email,password}));await reload();navigate(signedInDestination(result));}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const unavailable=providersError?'Sign-in availability could not be checked. Email sign-in is still available.':providersLoading?'Checking sign-in options. You can continue with email now.':providers.google&&providers.github?'Continue with Google, GitHub or email.':providers.github?'Continue with GitHub or email.':providers.google?'Continue with Google or email.':'Social sign-in is not configured. Use email below.';
  return <div className="auth-page">
    <Link className="auth-back" to="/"><ArrowLeft size={16}/>Back to Traqiva</Link>
    <div className="auth-box">
      <Link to="/" aria-label="Traqiva homepage"><Logo compact/></Link>
      <h1>{signup?'Create your Traqiva account':'Welcome back.'}</h1>
      <p className="auth-description">{signup?'A clearer view of your AI starts here.':'Sign in to your workspace.'}</p>
      <ErrorNotice message={oauthAuthError(oauthCode,params.get('oauth_provider'))||(params.get('oauth')==='success'&&!loading&&!session?.user?'Your sign-in session could not be verified. Please try again or use email.':'')}/>
      <button className="button oauth google" disabled={providersLoading||!providers.google||!!redirecting||busy} aria-busy={redirecting==='google'} title={providersLoading?'Checking Google sign-in availability':providers.google?'Continue securely with Google':'Google sign-in is not configured'} onClick={()=>continueWith('google')}>{redirecting==='google'?<Spinner/>:<GoogleMark/>}Continue with Google</button>
      <button className="button oauth" disabled={providersLoading||!providers.github||!!redirecting||busy} aria-busy={redirecting==='github'} title={providersLoading?'Checking GitHub sign-in availability':providers.github?'Continue securely with GitHub':'GitHub sign-in is not configured'} onClick={()=>continueWith('github')}>{redirecting==='github'?<Spinner/>:<GitHubMark/>}Continue with GitHub</button>
      <p className="oauth-note">{unavailable}</p>
      {!emailMode?<button className="button oauth email-option" disabled={!!redirecting} onClick={()=>setEmailMode(true)}><Mail size={17}/>Continue with email<ArrowRight size={16}/></button>:<form onSubmit={submit}>
        {signup&&<label className="field">Your name<input autoComplete="name" required maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="Alex Morgan"/></label>}
        <label className="field">Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></label>
        <label className="field">Password<input type="password" autoComplete={signup?'new-password':'current-password'} minLength={12} required value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 12 characters"/></label>
        <ErrorNotice message={error}/>
        <button className="button primary full-width" disabled={busy||!!redirecting}>{busy?<Spinner/>:<>{signup?'Create account':'Sign in'}<ArrowRight size={16}/></>}</button>
      </form>}
      <div className="auth-alternatives"><button disabled title="Enterprise SSO is not configured">Use SSO</button><button disabled title="Passkey sign-in is not available">Use a passkey</button></div>
      <div className="auth-switch">{signup?'Have an account?':'New here?'} <Link to={signup?'/login':'/signup'}>{signup?'Sign in':'Create an account'}</Link></div>
      <p className="privacy-note"><ShieldCheck size={14}/>Your prompts are never used to train our models.</p>
    </div>
    <footer className="auth-footer">Traqiva · AI observability, with clarity.</footer>
  </div>;
}
