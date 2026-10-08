import {
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  InitiateAuthCommand,
  RevokeTokenCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  AuthFlowType,
} from "@aws-sdk/client-cognito-identity-provider";
import { cognitoClient, getCognitoClientId } from "../config/cognito";

export type AuthTokens = {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
};

let sessionVersion = 0;
let pendingRefresh: { token: string; version: number; promise: Promise<AuthTokens> } | undefined;

export const getSessionVersion = () => sessionVersion;

export class SessionChangedError extends Error {
  constructor() {
    super('Session changed. Please sign in again.');
    this.name = 'SessionChangedError';
  }
}

function storeTokens(tokens: AuthTokens) {
  localStorage.setItem('accessToken', tokens.accessToken);
  localStorage.setItem('idToken', tokens.idToken);
  if (tokens.refreshToken) localStorage.setItem('refreshToken', tokens.refreshToken);
  else localStorage.removeItem('refreshToken');
}

/**
 * Register a new user
 */
export const signUpUser = async (email: string, password: string, fullName: string) => {
  const command = new SignUpCommand({
    ClientId: getCognitoClientId(),
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "name", Value: fullName.trim() },
    ],
  });
  return await cognitoClient.send(command);
};

/**
 * Confirm verification code after sign up
 */
export const confirmSignUpUser = async (email: string, code: string) => {
  const command = new ConfirmSignUpCommand({
    ClientId: getCognitoClientId(),
    Username: email,
    ConfirmationCode: code,
  });
  try {
    return await cognitoClient.send(command);
  } catch (err: any) {
    // A prior attempt can confirm the user with Cognito and then fail on a
    // later step (sign-in, profile creation) - retrying the verify step would
    // otherwise surface this as a confusing error instead of proceeding.
    if (err.name === "NotAuthorizedException" && /current status is confirmed/i.test(err.message ?? "")) {
      return undefined;
    }
    throw err;
  }
};

/**
 * Request a new confirmation code for an unconfirmed sign-up
 */
export const resendConfirmationCode = async (email: string) => {
  const command = new ResendConfirmationCodeCommand({
    ClientId: getCognitoClientId(),
    Username: email,
  });
  return await cognitoClient.send(command);
};

/**
 * Sign in user with Email and Password
 */
export const signInUser = async (email: string, password: string) => {
  const version = ++sessionVersion;
  pendingRefresh = undefined;
  const command = new InitiateAuthCommand({
    AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
    ClientId: getCognitoClientId(),
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  });
  const response = await cognitoClient.send(command);

  if (sessionVersion !== version) throw new SessionChangedError();

  const { AccessToken, IdToken, RefreshToken } = response.AuthenticationResult ?? {};

  if (!AccessToken || !IdToken) {
    throw new Error("Sign in succeeded without the required authentication tokens.");
  }

  const tokens: AuthTokens = {
    accessToken: AccessToken,
    idToken: IdToken,
    ...(RefreshToken ? { refreshToken: RefreshToken } : {}),
  };

  storeTokens(tokens);

  return tokens;
};

/**
 * Exchange the stored refresh token for a new ID/access token pair, so a
 * backend call doesn't have to fail just because the short-lived ID token
 * expired - only a fully expired refresh token forces a real sign-in again.
 */
export const refreshSession = async (): Promise<AuthTokens> => {
  const token = localStorage.getItem('refreshToken');
  if (!token) throw new Error('No refresh token is available; sign in again.');
  const version = sessionVersion;
  if (pendingRefresh?.token === token && pendingRefresh.version === version) {
    return pendingRefresh.promise;
  }

  const promise = (async () => {
    const response = await cognitoClient.send(new InitiateAuthCommand({
      AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
      ClientId: getCognitoClientId(),
      AuthParameters: { REFRESH_TOKEN: token },
    }));
    if (sessionVersion !== version || localStorage.getItem('refreshToken') !== token) {
      throw new SessionChangedError();
    }
    const { AccessToken, IdToken, RefreshToken } = response.AuthenticationResult ?? {};
    if (!AccessToken || !IdToken) {
      throw new Error('Session refresh did not return the required authentication tokens.');
    }
    const tokens = { accessToken: AccessToken, idToken: IdToken, refreshToken: RefreshToken ?? token };
    storeTokens(tokens);
    return tokens;
  })();
  pendingRefresh = { token, version, promise };
  try {
    return await promise;
  } finally {
    if (pendingRefresh?.promise === promise) pendingRefresh = undefined;
  }
};

export const signOutUser = async (): Promise<void> => {
  const refreshToken = localStorage.getItem('refreshToken');
  sessionVersion += 1;
  pendingRefresh = undefined;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('idToken');
  localStorage.removeItem('refreshToken');
  if (refreshToken) {
    // Local logout must succeed even when Cognito cannot be reached. Awaited
    // directly (not a detached fire-and-forget) so callers who await this can
    // rely on the revoke having actually been attempted before continuing -
    // an un-awaited promise with no reference anywhere risks never running
    // its catch handler if the tab closes first.
    try {
      await cognitoClient.send(new RevokeTokenCommand({ ClientId: getCognitoClientId(), Token: refreshToken }));
    } catch {
      console.warn('Signed out locally; could not revoke the remote refresh token.');
    }
  }
};

// Always ask Cognito to validate the saved session before restoring private UI.
export const restoreSession = async (): Promise<AuthTokens | null> => {
  const token = localStorage.getItem('refreshToken');
  if (!token) return null;
  const version = sessionVersion;
  try {
    return await refreshSession();
  } catch (error) {
    if (sessionVersion === version && localStorage.getItem('refreshToken') === token
      && error instanceof Error && error.name === 'NotAuthorizedException') {
      await signOutUser();
      return null;
    }
    throw error;
  }
};

export const invalidatePendingSession = () => {
  sessionVersion += 1;
  pendingRefresh = undefined;
};

/**
 * Request a password reset code
 */
export const forgotPassword = async (email: string) => {
  const command = new ForgotPasswordCommand({
    ClientId: getCognitoClientId(),
    Username: email,
  });
  return await cognitoClient.send(command);
};

/**
 * Confirm new password with the reset code
 */
export const confirmForgotPassword = async (
  email: string,
  code: string,
  newPassword: string,
) => {
  const command = new ConfirmForgotPasswordCommand({
    ClientId: getCognitoClientId(),
    Username: email,
    ConfirmationCode: code,
    Password: newPassword,
  });
  return await cognitoClient.send(command);
};
