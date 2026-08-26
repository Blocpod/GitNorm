import { ensureSchema, getD1, makeId, sha256Text } from "@/lib/gitnorm";

export const SESSION_SECONDS = 60 * 60 * 24 * 30;
export const CHALLENGE_SECONDS = 60 * 10;

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function fromBase64url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(
    normalized + "=".repeat((4 - (normalized.length % 4)) % 4),
  );
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
export function toBase64url(bytes: Uint8Array) {
  return base64url(bytes);
}
export function relyingParty(request: Request) {
  const url = new URL(request.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    return { origin: url.origin, rpID: url.hostname };
  const productionHost = "gitnorm.blocpodcreative.chatgpt.site";
  if (url.hostname !== productionHost)
    throw new Error(
      "Passkeys are available only on GitNorm's canonical address.",
    );
  return { origin: `https://${productionHost}`, rpID: productionHost };
}
export function authCookieName(
  request: Request,
  kind: "session" | "challenge",
) {
  const secure = new URL(request.url).protocol === "https:";
  return `${secure ? "__Host-" : ""}gitnorm_${kind}`;
}
export function cookieHeader(
  request: Request,
  kind: "session" | "challenge",
  value: string,
  maxAge: number,
) {
  const secure = new URL(request.url).protocol === "https:";
  return `${authCookieName(request, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
export function clearCookieHeader(
  request: Request,
  kind: "session" | "challenge",
) {
  return cookieHeader(request, kind, "", 0);
}

export async function saveChallenge(
  request: Request,
  input: {
    kind: "register" | "login";
    challenge: string;
    userId?: string;
    handle?: string;
    displayName?: string;
  },
) {
  await ensureSchema();
  const token = randomToken();
  const tokenHash = await sha256Text(token);
  const now = Date.now();
  await getD1().batch([
    getD1()
      .prepare("DELETE FROM auth_challenges WHERE expires_at<=?")
      .bind(now),
    getD1()
      .prepare(
        "INSERT INTO auth_challenges (token_hash,kind,challenge,user_id,handle,display_name,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .bind(
        tokenHash,
        input.kind,
        input.challenge,
        input.userId || null,
        input.handle || null,
        input.displayName || null,
        now + CHALLENGE_SECONDS * 1000,
        now,
      ),
  ]);
  return {
    token,
    setCookie: cookieHeader(request, "challenge", token, CHALLENGE_SECONDS),
  };
}

export async function takeChallenge(
  request: Request,
  kind: "register" | "login",
) {
  await ensureSchema();
  const cookie = request.headers.get("cookie") || "";
  const name = authCookieName(request, "challenge");
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!token) return null;
  const tokenHash = await sha256Text(token);
  const row = await getD1()
    .prepare(
      "SELECT token_hash AS tokenHash,kind,challenge,user_id AS userId,handle,display_name AS displayName,expires_at AS expiresAt FROM auth_challenges WHERE token_hash=?",
    )
    .bind(tokenHash)
    .first<{
      tokenHash: string;
      kind: string;
      challenge: string;
      userId: string | null;
      handle: string | null;
      displayName: string | null;
      expiresAt: number;
    }>();
  await getD1()
    .prepare("DELETE FROM auth_challenges WHERE token_hash=?")
    .bind(tokenHash)
    .run();
  if (!row || row.kind !== kind || row.expiresAt <= Date.now()) return null;
  return row;
}

export async function createSession(request: Request, userId: string) {
  await ensureSchema();
  const token = randomToken();
  const tokenHash = await sha256Text(token);
  const now = Date.now();
  await getD1().batch([
    getD1().prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
    getD1()
      .prepare(
        "INSERT INTO sessions (token_hash,user_id,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?)",
      )
      .bind(tokenHash, userId, now, now + SESSION_SECONDS * 1000, now),
  ]);
  return cookieHeader(request, "session", token, SESSION_SECONDS);
}

export async function destroySession(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const names = ["__Host-gitnorm_session", "gitnorm_session"];
  for (const name of names) {
    const token = cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    if (token)
      await getD1()
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .bind(await sha256Text(token))
        .run();
  }
}

export function cleanHandle(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}
export function validHandle(value: string) {
  return /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/.test(value);
}
export function newUserId() {
  return makeId("usr");
}
