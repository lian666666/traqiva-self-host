const accountCollisionMessage=(provider:'Google'|'GitHub')=>`An account already exists for this address. Sign in using your existing Google, GitHub or email account, then connect ${provider} from your account settings.`;

export function googleAuthError(code:string|null){
  if(!code)return '';
  const messages:Record<string,string>={
    email_signin_required:accountCollisionMessage('Google'),
    access_denied:'Google sign-in was cancelled. You can try again or continue with email.',
    cancelled:'Google sign-in was cancelled. You can try again or continue with email.',
    invalid_state:'The Google sign-in session expired or could not be verified. Please start again.',
    state_mismatch:'The Google sign-in session could not be verified. Please start again.',
    expired_state:'The Google sign-in session expired. Please start again.',
    google_not_configured:'Google sign-in is not available right now. You can continue with email.',
    not_configured:'Google sign-in is not available right now. You can continue with email.',
    email_unverified:'Google did not provide a verified email address. Please use a verified Google account or continue with email.',
    identity_in_use:'This Google account is already connected to another Traqiva account. Use the matching account to sign in.',
    already_linked:'A Google account is already connected to this Traqiva account.',
    link_session_expired:'Your account session expired before Google could be connected. Sign in again and retry from account settings.',
    session_required:'Sign in with your current account before connecting Google.',
    signin_required:'Sign in with your current account before connecting Google.',
    google_unavailable:'Google sign-in is not available right now. You can continue with email.',
    account_conflict:'This Google identity cannot be connected to this account. Use the same verified email as your existing Traqiva account.',
    invalid_identity:'Google could not provide a valid, verified account identity. Please try another account or continue with email.',
  };
  return Object.hasOwn(messages,code)?messages[code]:'Google sign-in could not be completed. Please try again or continue with email.';
}

export function oauthAuthError(code:string|null,provider:string|null=null){
  if(!code)return '';
  const github=provider==='github'||code.startsWith('github_');
  if(!github)return googleAuthError(code);
  if(code==='email_signin_required')return accountCollisionMessage('GitHub');
  if(code==='github_email_required'||code==='email_unverified')return 'GitHub did not provide a verified email address. Verify an email in your GitHub account or continue with email.';
  const normalized=code.startsWith('github_')?`google_${code.slice(7)}`:code;
  return googleAuthError(normalized).replaceAll('Google','GitHub');
}
