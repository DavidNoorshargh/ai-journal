import { aws } from "@/aws";

export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

export class SessionExpired extends Error {
  constructor() {
    super("Session expired.");
    this.name = "SessionExpired";
  }
}

export class AwsCallError extends Error {
  readonly type: string;

  constructor(type: string) {
    super(type);
    this.name = "AwsCallError";
    this.type = type;
  }
}

type JsonCall = (url: string, target: string, body: unknown) => Promise<unknown>;

type AuthResult = {
  AuthenticationResult?: {
    RefreshToken?: string;
    IdToken?: string;
  };
};

type IdentityId = {
  IdentityId?: string;
};

type IssuedCredentials = {
  Credentials?: {
    AccessKeyId?: string;
    SecretKey?: string;
    SessionToken?: string;
  };
};

export async function exchangePassword(
  email: string,
  password: string,
  call: JsonCall = awsJson,
): Promise<string> {
  const result = await authCall(call, "InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: aws.clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  return refreshTokenFrom(result);
}

export async function credentialsFor(refreshToken: string, call: JsonCall = awsJson): Promise<AwsCredentials> {
  const idToken = await idTokenFor(refreshToken, call);
  return identityCredentials(idToken, call);
}

async function authCall(call: JsonCall, action: string, body: unknown): Promise<AuthResult> {
  try {
    return (await call(idpUrl(), `AWSCognitoIdentityProviderService.${action}`, body)) as AuthResult;
  } catch (error) {
    throw signInFailure(error);
  }
}

async function idTokenFor(refreshToken: string, call: JsonCall): Promise<string> {
  let result: AuthResult;
  try {
    result = (await call(idpUrl(), "AWSCognitoIdentityProviderService.InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: aws.clientId,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    })) as AuthResult;
  } catch (error) {
    throw sessionFailure(error);
  }
  const token = result.AuthenticationResult?.IdToken;
  if (typeof token !== "string" || token === "") {
    throw new SessionExpired();
  }
  return token;
}

async function identityCredentials(idToken: string, call: JsonCall): Promise<AwsCredentials> {
  const logins = { [loginProvider()]: idToken };
  let identity: IdentityId;
  let issued: IssuedCredentials;
  try {
    identity = (await call(identityUrl(), identityTarget("GetId"), {
      IdentityPoolId: aws.identityPoolId,
      Logins: logins,
    })) as IdentityId;
    issued = (await call(identityUrl(), identityTarget("GetCredentialsForIdentity"), {
      IdentityId: identity.IdentityId,
      Logins: logins,
    })) as IssuedCredentials;
  } catch (error) {
    throw sessionFailure(error);
  }
  return requireCredentials(issued);
}

function refreshTokenFrom(result: AuthResult): string {
  const token = result.AuthenticationResult?.RefreshToken;
  if (typeof token !== "string" || token === "") {
    throw new Error("Sign in failed.");
  }
  return token;
}

function requireCredentials(issued: IssuedCredentials): AwsCredentials {
  const credentials = issued.Credentials;
  if (
    credentials === undefined ||
    typeof credentials.AccessKeyId !== "string" ||
    typeof credentials.SecretKey !== "string" ||
    typeof credentials.SessionToken !== "string"
  ) {
    throw new SessionExpired();
  }
  return {
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretKey,
    sessionToken: credentials.SessionToken,
  };
}

function signInFailure(error: unknown): Error {
  if (error instanceof AwsCallError && error.type === "NotAuthorizedException") {
    return new Error("Email or password is incorrect.");
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error("Sign in failed.");
}

function sessionFailure(error: unknown): Error {
  if (error instanceof AwsCallError && error.type === "NotAuthorizedException") {
    return new SessionExpired();
  }
  if (error instanceof Error) {
    return error;
  }
  return new SessionExpired();
}

async function awsJson(url: string, target: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": target,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { __type?: string };
  if (!response.ok) {
    throw new AwsCallError(errorType(payload.__type));
  }
  return payload;
}

function errorType(type: string | undefined): string {
  if (type === undefined || type === "") {
    return "Sign in failed.";
  }
  const hash = type.lastIndexOf("#");
  return hash === -1 ? type : type.slice(hash + 1);
}

function idpUrl(): string {
  return `https://cognito-idp.${aws.region}.amazonaws.com/`;
}

function identityUrl(): string {
  return `https://cognito-identity.${aws.region}.amazonaws.com/`;
}

function identityTarget(action: string): string {
  return `com.amazonaws.cognito.identity.model.AWSCognitoIdentityService.${action}`;
}

function loginProvider(): string {
  return `cognito-idp.${aws.region}.amazonaws.com/${aws.userPoolId}`;
}
