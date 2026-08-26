import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { relyingParty, saveChallenge } from "@/lib/auth";
import { ensureSchema, json, rateLimit, validMutation } from "@/lib/gitnorm";

export async function POST(request: Request) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);
  await ensureSchema();
  if (!(await rateLimit(request, "login-options", 20, 600000)))
    return json(
      { error: "Too many sign-in attempts. Try again in ten minutes." },
      429,
    );
  const { rpID } = relyingParty(request);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    timeout: 120000,
  });
  const pending = await saveChallenge(request, {
    kind: "login",
    challenge: options.challenge,
  });
  return new Response(JSON.stringify({ options }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": pending.setCookie,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
