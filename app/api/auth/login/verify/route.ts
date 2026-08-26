import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import {
  clearCookieHeader,
  createSession,
  fromBase64url,
  relyingParty,
  takeChallenge,
} from "@/lib/auth";
import {
  ensureSchema,
  getD1,
  json,
  rateLimit,
  validMutation,
} from "@/lib/gitnorm";

export async function POST(request: Request) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);
  await ensureSchema();
  if (!(await rateLimit(request, "login-verify", 30, 600000)))
    return json(
      { error: "Too many sign-in attempts. Try again in ten minutes." },
      429,
    );
  const pending = await takeChallenge(request, "login");
  if (!pending)
    return json(
      { error: "That sign-in request expired. Please try again." },
      400,
    );
  try {
    const response = (await request.json()) as AuthenticationResponseJSON;
    const passkey = await getD1()
      .prepare(
        "SELECT credential_id AS credentialId,user_id AS userId,public_key AS publicKey,counter,transports FROM passkeys WHERE credential_id=?",
      )
      .bind(response.id)
      .first<{
        credentialId: string;
        userId: string;
        publicKey: string;
        counter: number;
        transports: string;
      }>();
    if (!passkey)
      return json(
        { error: "That passkey is not registered with GitNorm." },
        404,
      );
    if (response.response.userHandle) {
      const claimedUser = new TextDecoder().decode(
        fromBase64url(response.response.userHandle),
      );
      if (claimedUser !== passkey.userId)
        return json(
          { error: "That passkey belongs to a different account." },
          401,
        );
    }
    const { origin, rpID } = relyingParty(request);
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: fromBase64url(passkey.publicKey),
        counter: passkey.counter,
        transports: JSON.parse(
          passkey.transports,
        ) as AuthenticatorTransportFuture[],
      },
    });
    if (!result.verified)
      return json({ error: "We could not verify that passkey." }, 401);
    await getD1()
      .prepare(
        "UPDATE passkeys SET counter=?,last_used_at=? WHERE credential_id=?",
      )
      .bind(
        result.authenticationInfo.newCounter,
        Date.now(),
        passkey.credentialId,
      )
      .run();
    const session = await createSession(request, passkey.userId);
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    headers.append("Set-Cookie", session);
    headers.append("Set-Cookie", clearCookieHeader(request, "challenge"));
    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch {
    return json(
      {
        error: "We could not sign you in with that passkey. Please try again.",
      },
      401,
    );
  }
}
