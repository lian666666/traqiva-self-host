import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import Auth from '../src/Auth';
import Admin from '../src/pages/Admin';
import type { Session } from '../src/types';
import { oauthAuthError } from '../src/googleAuth';
import { signedInDestination } from '../src/setupState';

const state=vi.hoisted(()=>({
  providers:{google:true,github:true},loading:false,error:'',session:null as Session|null,
}));
vi.mock('../src/api',()=>({
  useApp:()=>({session:state.session,loading:false,reload:async()=>{}}),
  useResource:()=>({data:state.providers,loading:state.loading,error:state.error}),
  api:vi.fn(),json:vi.fn(),
}));

function renderAuth(path='/signup'){
  return renderToStaticMarkup(createElement(MemoryRouter,{initialEntries:[path]},createElement(Auth,{signup:path.startsWith('/signup')})));
}
function socialButton(html:string,provider:string){
  const match=html.match(new RegExp(`<button[^>]*>(?:(?!<button)[\\s\\S])*?Continue with ${provider}</button>`));
  if(!match)throw new Error(`Missing ${provider} sign-in button`);
  return match[0];
}

beforeEach(()=>{state.providers={google:true,github:true};state.loading=false;state.error='';state.session=null;});

describe('GitHub sign-in availability',()=>{

  it('offers GitHub sign-in when the server enables it without a false unavailable notice',()=>{
    const html=renderAuth();
    expect(socialButton(html,'GitHub')).not.toContain('disabled');
    expect(html).not.toContain('GitHub sign-in is not configured');
    expect(socialButton(html,'Google')).not.toContain('disabled');
    expect(html).toContain('Continue with email');
  });

  it('keeps GitHub usable when Google is unavailable',()=>{
    state.providers={google:false,github:true};
    const html=renderAuth('/login');
    expect(socialButton(html,'GitHub')).not.toContain('disabled');
    expect(socialButton(html,'Google')).toContain('disabled');
    expect(html).not.toContain('Social sign-in is not configured');
  });

  it('keeps both social buttons disabled until provider availability is known',()=>{
    state.loading=true;
    const html=renderAuth();
    expect(socialButton(html,'GitHub')).toContain('disabled');
    expect(socialButton(html,'Google')).toContain('disabled');
    expect(html).toContain('Continue with email');
  });

  it('disables only GitHub when it is not configured',()=>{
    state.providers={google:true,github:false};
    const html=renderAuth();
    expect(socialButton(html,'GitHub')).toContain('disabled');
    expect(socialButton(html,'Google')).not.toContain('disabled');
    expect(html).toContain('Continue with email');
  });
});

describe('GitHub account linking',()=>{
  function renderAccount(linked:boolean|undefined,path='/app/admin'){
    state.session={user:{id:'user-test',name:'Alex',email:'alex@example.test',google_linked:false,github_linked:linked},workspace:null,projects:[],activeProject:null};
    return renderToStaticMarkup(createElement(MemoryRouter,{initialEntries:[path]},createElement(Admin)));
  }

  it('offers an explicit GitHub connection for an authenticated account',()=>{
    const html=renderAccount(false);
    expect(html).toContain('Connect GitHub account');
    expect(html).toContain('same verified email');
    expect(html).not.toContain('GitHub sign-in is not configured');
  });

  it('confirms a connection only when the refreshed session verifies the identity',()=>{
    expect(renderAccount(true,'/app/admin?github=linked')).toContain('GitHub is connected to your account.');
    const html=renderAccount(false,'/app/admin?github=linked');
    expect(html).not.toContain('GitHub is connected to your account.');
    expect(html).toContain('Connect GitHub account');
  });

  it('requires a session refresh before connecting when linked status is missing',()=>{
    const html=renderAccount(undefined);
    expect(html).toContain('Connection status is unavailable');
    expect(html.match(/<button[^>]*disabled[^>]*>(?:(?!<button)[\s\S])*?Connect GitHub account<\/button>/)?.[0]).toBeTruthy();
  });
});

describe('GitHub callback feedback',()=>{
  it('preserves the GitHub provider when an authenticated callback error opens account settings',()=>{
    const session:Session={user:null,workspace:null,projects:[],activeProject:null,setup:{stage:'complete',goals:['coding'],project_id:null},terms:{version:'test',accepted:true,accepted_at:'2026-10-21T12:00:00Z'}};
    expect(signedInDestination(session,'account_conflict','github')).toBe('/app/admin?oauth_error=account_conflict&oauth_provider=github');
    expect(signedInDestination({...session,setup:undefined},'account_conflict','github')).toBe('/onboarding?oauth_error=account_conflict&oauth_provider=github');
    expect(signedInDestination(session,'account_conflict','untrusted?code=secret')).not.toContain('secret');
  });

  it('preserves existing social sign-in options before explicitly linking GitHub',()=>{
    const html=renderAuth('/login?oauth_error=email_signin_required&oauth_provider=github');
    expect(html).toContain('Sign in using your existing Google, GitHub or email account');
    expect(html).toContain('connect GitHub from your account settings');
    expect(html).toContain('Email address');
    expect(socialButton(html,'Google')).not.toContain('disabled');
    expect(socialButton(html,'GitHub')).not.toContain('disabled');
    expect(html).not.toContain('email and password');
    expect(html).not.toContain('connect Google from your account settings');
  });

  it('explains GitHub cancellation and missing verified email without leaking callback data',()=>{
    expect(oauthAuthError('access_denied','github')).toContain('GitHub sign-in was cancelled');
    expect(oauthAuthError('github_email_required')).toContain('verified email');
    expect(oauthAuthError('github_unavailable')).toContain('not available');
    const message=oauthAuthError('unexpected?code=PRIVATE_CODE&email=private@example.invalid','github');
    expect(message).toContain('GitHub sign-in could not be completed');
    expect(message).not.toContain('PRIVATE_CODE');
    expect(message).not.toContain('private@example.invalid');
  });
});
