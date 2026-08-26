import { currentProfile, json } from "@/lib/gitnorm";

export async function GET() {
  const profile = await currentProfile();
  return profile ? json({ user: profile }) : json({ user: null }, 401);
}
