import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

// A function rather than a module-level constant, so merely importing this
// module (including transitively, e.g. through backendApi.ts) never throws -
// only actually calling a Cognito operation without the required env var does.
export function getCognitoClientId(): string {
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;

  if (!clientId) {
    throw new Error(
      "Missing VITE_COGNITO_CLIENT_ID. Set it in .env.local for development (see .env.example), " +
        "or in your own build environment.",
    );
  }

  return clientId;
}

export const cognitoClient = new CognitoIdentityProviderClient({
  region: import.meta.env.VITE_AWS_REGION || "us-east-1",
});
