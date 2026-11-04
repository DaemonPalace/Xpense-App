import './crypto-polyfill';

import {
  AuthenticationDetails,
  CognitoRefreshToken,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';

import { config } from './config';

// SRP sign-in: the password never leaves the device, only a proof of it (requirements.md §4).
// Tokens are persisted by session.ts in SecureStore; the library itself only gets in-memory storage.

export class CognitoError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface Tokens {
  username: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const memory: Record<string, string> = {};
const Storage = {
  setItem: (k: string, v: string) => (memory[k] = v),
  getItem: (k: string) => memory[k] ?? null,
  removeItem: (k: string) => delete memory[k],
  clear: () => Object.keys(memory).forEach((k) => delete memory[k]),
};

const pool = new CognitoUserPool({ UserPoolId: config.userPoolId, ClientId: config.clientId, Storage });
const user = (email: string) => new CognitoUser({ Username: email, Pool: pool, Storage });

const fail = (err: any) => new CognitoError(err?.code ?? err?.name ?? 'Unknown', err?.message ?? '');

/** Adapts the library's (err, result) callbacks to a promise with CognitoError. */
function cb<T>(run: (done: (err: any, result?: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => run((err, result) => (err ? reject(fail(err)) : resolve(result as T))));
}

const toTokens = (username: string, s: CognitoUserSession): Tokens => ({
  username,
  accessToken: s.getAccessToken().getJwtToken(),
  refreshToken: s.getRefreshToken().getToken(),
  expiresAt: s.getAccessToken().getExpiration() * 1000,
});

export const signUp = (email: string, password: string) =>
  cb((done) => pool.signUp(email, password, [new CognitoUserAttribute({ Name: 'email', Value: email })], [], done));
export const confirmSignUp = (email: string, code: string) => cb((done) => user(email).confirmRegistration(code, true, done));
export const resendCode = (email: string) => cb((done) => user(email).resendConfirmationCode(done));
export const forgotPassword = (email: string) =>
  new Promise<void>((resolve, reject) => user(email).forgotPassword({ onSuccess: () => resolve(), onFailure: (e) => reject(fail(e)), inputVerificationCode: () => resolve() }));
export const confirmForgotPassword = (email: string, code: string, password: string) =>
  new Promise<void>((resolve, reject) => user(email).confirmPassword(code, password, { onSuccess: () => resolve(), onFailure: (e) => reject(fail(e)) }));

export function signIn(email: string, password: string): Promise<Tokens> {
  return new Promise((resolve, reject) =>
    user(email).authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
      onSuccess: (s) => resolve(toTokens(email, s)),
      onFailure: (e) => reject(fail(e)),
      // Pool has no MFA and users never get temporary passwords (self sign-up only).
      newPasswordRequired: () => reject(new CognitoError('NewPasswordRequired', '')),
    }),
  );
}

export const refresh = (t: Tokens): Promise<Tokens> =>
  cb<CognitoUserSession>((done) => user(t.username).refreshSession(new CognitoRefreshToken({ RefreshToken: t.refreshToken }), done)).then((s) =>
    toTokens(t.username, s),
  );
