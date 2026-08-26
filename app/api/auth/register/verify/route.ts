import {
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  clearCookieHeader,
  createSession,
  relyingParty,
  takeChallenge,
  toBase64url,
} from "@/lib/auth";
import { getD1, json, validMutation } from "@/lib/gitnorm";

export async function POST(request: Request) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);
  const pending = await takeChallenge(request, "register");
  if (!pending?.userId || !pending.handle || !pending.displayName)
    return json(
      { error: "That sign-up request expired. Please try again." },
      400,
    );
  try {
    const response = (await request.json()) as RegistrationResponseJSON;
    const { origin, rpID } = relyingParty(request);
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!result.verified || !result.registrationInfo)
      return json({ error: "We could not verify that passkey." }, 400);
    const now = Date.now();
    const credential = result.registrationInfo.credential;
    await getD1().batch([
      getD1()
        .prepare(
          "INSERT INTO profiles (id,email,display_name,handle,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          pending.userId,
          "",
          pending.displayName,
          pending.handle,
          now,
          now,
        ),
      getD1()
        .prepare(
          "INSERT INTO passkeys (credential_id,user_id,public_key,counter,transports,device_type,backed_up,created_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          credential.id,
          pending.userId,
          toBase64url(credential.publicKey),
          credential.counter,
          JSON.stringify(credential.transports || []),
          result.registrationInfo.credentialDeviceType,
          result.registrationInfo.credentialBackedUp ? 1 : 0,
          now,
        ),
    ]);
    const session = await createSession(request, pending.userId);
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    headers.append("Set-Cookie", session);
    headers.append("Set-Cookie", clearCookieHeader(request, "challenge"));
    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch (error) {
    const message =
      error instanceof Error && /UNIQUE|constraint/i.test(error.message)
        ? "That handle or passkey is already registered."
        : "We could not finish creating your account. Please try again.";
    return json({ error: message }, 409);
  }
}
