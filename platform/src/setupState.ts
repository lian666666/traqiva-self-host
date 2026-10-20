import type { ConnectionStatus,Session } from './types';
export const TERMS_VERSION='2026-10-20.1';
export function setupRequired(session:Session){return session.setup?.stage!=='complete'||session.terms?.accepted!==true;}
export function setupStageFor(session:Session|null){const stage=session?.setup?.stage||'goals';return stage==='complete'&&session?.terms?.accepted!==true?'connect':stage;}
export function signedInDestination(session:Session,oauthError:string|null=null){const path=setupRequired(session)?'/onboarding':oauthError?'/app/admin':'/app/home';return oauthError?`${path}?oauth_error=${encodeURIComponent(oauthError)}`:path;}
export function setupProjectFor(session:Session){return session.projects.find(project=>project.id===session.setup?.project_id)||session.activeProject||session.projects[0]||null;}
export function canCheckConnection(stage:string,accepted:boolean,visible:boolean,online:boolean){return stage==='connect'&&accepted&&visible&&online;}
export function canFinishSetup(status:ConnectionStatus|null,accepted:boolean){return accepted&&status?.connected===true;}
