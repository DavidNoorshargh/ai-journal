import { AwsCallError, credentialsFor, exchangePassword, SessionExpired } from "@/session/cognito";

describe("Cognito session", () => {
  it("asks for a refresh token and keeps the password out of the result", async () => {
    let sent: unknown;
    const token = await exchangePassword("journal@example.com", "secret-password", async (_url, target, body) => {
      sent = { target, body };
      return { AuthenticationResult: { RefreshToken: "refresh-token" } };
    });

    expect(token).toBe("refresh-token");
    expect(sent).toEqual({
      target: "AWSCognitoIdentityProviderService.InitiateAuth",
      body: {
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: "5t3mjg0hma7g13s2120dgkt7tu",
        AuthParameters: { USERNAME: "journal@example.com", PASSWORD: "secret-password" },
      },
    });
  });

  it("says when the email or password is rejected", async () => {
    await expect(
      exchangePassword("journal@example.com", "nope", async () => {
        throw new AwsCallError("NotAuthorizedException");
      }),
    ).rejects.toThrow("Email or password is incorrect.");
  });

  it("turns an expired refresh token into a signed-out session", async () => {
    await expect(
      credentialsFor("expired-refresh", async () => {
        throw new AwsCallError("NotAuthorizedException");
      }),
    ).rejects.toBeInstanceOf(SessionExpired);
  });
});
