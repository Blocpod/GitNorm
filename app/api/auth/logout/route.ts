import { clearCookieHeader, destroySession } from "@/lib/auth";
import { json, validMutation } from "@/lib/gitnorm";

export async function POST(request: Request) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);
  await destroySession(request);
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": clearCookieHeader(request, "session"),
      "Cache-Control": "no-store",
    },
  });
}
