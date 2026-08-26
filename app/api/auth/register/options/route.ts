import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  cleanHandle,
  newUserId,
  relyingParty,
  saveChallenge,
  validHandle,
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
  if (!(await rateLimit(request, "register-options", 8, 600000)))
    return json(
      { error: "Too many sign-up attempts. Try again in ten minutes." },
      429,
    );
  const input = (await request.json().catch(() => ({}))) as {
    displayName?: unknown;
    handle?: unknown;
  };
  const displayName = String(input.displayName || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
  const handle = cleanHandle(input.handle);
  if (displayName.length < 2)
    return json({ error: "Enter the name you want people to see." }, 400);
  if (!validHandle(handle))
    return json(
      {
        error:
          "Use 3–30 letters, numbers, underscores, or dashes for your handle.",
      },
      400,
    );
  if (
    await getD1()
      .prepare("SELECT id FROM profiles WHERE handle=?")
      .bind(handle)
      .first()
  )
    return json({ error: "That handle is already taken." }, 409);
  const userId = newUserId();
  const { rpID } = relyingParty(request);
  const options = await generateRegistrationOptions({
    rpName: "GitNorm",
    rpID,
    userID: new TextEncoder().encode(userId),
    userName: handle,
    userDisplayName: displayName,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    preferredAuthenticatorType: "localDevice",
    timeout: 120000,
  });
  const challenge = await saveChallenge(request, {
    kind: "register",
    challenge: options.challenge,
    userId,
    handle,
    displayName,
  });
  return new Response(JSON.stringify({ options }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": challenge.setCookie,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
