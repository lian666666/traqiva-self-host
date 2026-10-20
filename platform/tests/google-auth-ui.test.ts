import { describe,expect,it } from 'vitest';
import { googleAuthError } from '../src/googleAuth';

describe('Google sign-in error presentation',()=>{
  it('requires email authentication and explicit account linking for an existing email',()=>{
    const message=googleAuthError('email_signin_required');
    expect(message).toContain('Sign in with your email and password');
    expect(message).toContain('connect Google from your account settings');
  });

  it('distinguishes cancellation, expired state and account conflict without claiming success',()=>{
    expect(googleAuthError('access_denied')).toContain('cancelled');
    expect(googleAuthError('invalid_state')).toContain('expired or could not be verified');
    expect(googleAuthError('account_conflict')).toContain('same verified email');
    expect(googleAuthError('google_unavailable')).toContain('not available');
  });

  it('does not reflect an unknown callback value or its sensitive details',()=>{
    const raw='unexpected_error?code=PRIVATE_AUTHORIZATION_CODE&email=private@example.invalid';
    const message=googleAuthError(raw);
    expect(message).toBe('Google sign-in could not be completed. Please try again or continue with email.');
    expect(message).not.toContain('PRIVATE_AUTHORIZATION_CODE');
    expect(message).not.toContain('private@example.invalid');
  });

  it('safely handles inherited object property names as unknown callback values',()=>{
    for(const value of ['__proto__','constructor','toString']){
      expect(googleAuthError(value)).toBe('Google sign-in could not be completed. Please try again or continue with email.');
    }
  });

  it('does not display an error without a callback error code',()=>{
    expect(googleAuthError(null)).toBe('');
    expect(googleAuthError('')).toBe('');
  });
});
