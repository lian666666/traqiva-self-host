import { describe,expect,it } from 'vitest';
import { canCheckConnection,canFinishSetup,setupProjectFor,setupRequired,setupStageFor,signedInDestination } from '../src/setupState';
import type { ConnectionStatus,Session } from '../src/types';
const session=(stage:'goals'|'project'|'connect'|'complete'):Session=>({user:{id:'user-a',name:'A',email:'a@example.invalid'},workspace:null,projects:[{id:'initial',name:'Existing real agent'},{id:'chosen',name:'Selected project'}],activeProject:{id:'initial',name:'Existing real agent'},setup:{stage,goals:['coding'],project_id:'chosen'},terms:{version:'2026-10-20.1',accepted:true,accepted_at:'2026-10-20T10:00:00Z'}});

describe('server-owned setup routing',()=>{
  it.each(['goals','project','connect'] as const)('keeps a signed-in %s stage in onboarding',stage=>{expect(setupRequired(session(stage))).toBe(true);expect(signedInDestination(session(stage))).toBe('/onboarding');});
  it('opens the workspace only after the server marks setup complete',()=>{expect(setupRequired(session('complete'))).toBe(false);expect(signedInDestination(session('complete'))).toBe('/app/home');});
  it('requires setup if a legacy response has no authoritative stage',()=>{const legacy=session('goals');delete legacy.setup;expect(signedInDestination(legacy)).toBe('/onboarding');});
  it('preserves a safe OAuth error on the appropriate server-owned route',()=>{expect(signedInDestination(session('connect'),'access_denied')).toBe('/onboarding?oauth_error=access_denied');expect(signedInDestination(session('complete'),'email_signin_required')).toBe('/app/admin?oauth_error=email_signin_required');});
  it('uses the server-selected existing project instead of another active browser selection',()=>{expect(setupProjectFor(session('project'))).toEqual({id:'chosen',name:'Selected project'});});
  it('requires current consent even when the server previously completed setup',()=>{const expired=session('complete');expired.terms={version:'2026-10-21.1',accepted:false,accepted_at:null};expect(setupRequired(expired)).toBe(true);expect(signedInDestination(expired)).toBe('/onboarding');expect(setupStageFor(expired)).toBe('connect');expect(expired.setup?.stage).toBe('complete');});
  it('does not treat missing consent state as acceptance',()=>{const missing=session('complete');delete missing.terms;expect(setupRequired(missing)).toBe(true);expect(setupStageFor(missing)).toBe('connect');});
  it('returns a previously completed account home after current consent is accepted without repeating setup',()=>{const renewed=session('complete');renewed.terms={version:'2026-10-21.1',accepted:true,accepted_at:'2026-10-21T10:00:00Z'};expect(setupStageFor(renewed)).toBe('complete');expect(signedInDestination(renewed)).toBe('/app/home');});
});

describe('real connection evidence and consent',()=>{
  const connected:ConnectionStatus={connected:true,method:'compression',last_activity_at:'2026-10-20T10:00:00Z'};
  it('does not enable normal completion without both current consent and server evidence',()=>{expect(canFinishSetup(null,true)).toBe(false);expect(canFinishSetup({...connected,connected:false},true)).toBe(false);expect(canFinishSetup(connected,false)).toBe(false);expect(canFinishSetup(connected,true)).toBe(true);});
  it('pauses checks when hidden, offline, before consent, or outside connection setup',()=>{expect(canCheckConnection('connect',true,true,true)).toBe(true);expect(canCheckConnection('connect',false,true,true)).toBe(false);expect(canCheckConnection('connect',true,false,true)).toBe(false);expect(canCheckConnection('connect',true,true,false)).toBe(false);expect(canCheckConnection('project',true,true,true)).toBe(false);expect(canCheckConnection('complete',true,true,true)).toBe(false);});
});
