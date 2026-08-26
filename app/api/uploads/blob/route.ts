import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import {
  currentProfile,
  getD1,
  json,
  MAX_REQUEST_SIZE,
  validMutation,
} from "@/lib/gitnorm";
import { storageMode } from "@/lib/storage";

export const runtime = "nodejs";

type PendingIntent = {
  id: string;
  ownerId: string;
  storageKey: string;
  status: string;
  expiresAt: number;
  tokenExpiresAt: number;
};

type CompletionPayload = {
  intentId?: unknown;
  pathname?: unknown;
};

class UploadRouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function parseClientIntent(clientPayload: string | null) {
  try {
    const parsed = JSON.parse(clientPayload || "{}") as { intentId?: unknown };
    return String(parsed.intentId || "").trim();
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  if (storageMode() !== "blob")
    return json({ error: "Vercel Blob uploads are disabled locally." }, 404);

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return json({ error: "That upload request was not valid JSON." }, 400);
  }

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!validMutation(request))
          throw new UploadRouteError(
            403,
            "This request came from an unexpected site.",
          );
        const profile = await currentProfile();
        if (!profile)
          throw new UploadRouteError(401, "Please sign in before uploading.");

        const intentId = parseClientIntent(clientPayload);
        if (!intentId)
          throw new UploadRouteError(400, "That upload intent was missing.");
        const intent = await getD1()
          .prepare(
            `SELECT id,owner_id AS ownerId,storage_key AS storageKey,status,
                    expires_at AS expiresAt,token_expires_at AS tokenExpiresAt
             FROM upload_intents WHERE id=? AND owner_id=?`,
          )
          .bind(intentId, profile.id)
          .first<PendingIntent>();
        if (!intent)
          throw new UploadRouteError(
            404,
            "That upload is no longer available.",
          );
        if (intent.status !== "pending")
          throw new UploadRouteError(409, "That upload has already been used.");
        if (intent.expiresAt <= Date.now()) {
          await getD1()
            .prepare(
              "UPDATE upload_intents SET status='expired' WHERE id=? AND status='pending'",
            )
            .bind(intent.id)
            .run();
          throw new UploadRouteError(
            410,
            "That upload expired. Start it again.",
          );
        }
        if (pathname !== intent.storageKey)
          throw new UploadRouteError(
            403,
            "That upload path was not authorized.",
          );

        return {
          allowedContentTypes: ["application/zip", "application/octet-stream"],
          maximumSizeInBytes: MAX_REQUEST_SIZE,
          validUntil: intent.tokenExpiresAt,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({ intentId: intent.id, pathname }),
        };
      },
      // Vercel authenticates this callback with its signature. It intentionally
      // does not require a browser cookie because it is sent by Blob, not the user.
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let payload: CompletionPayload;
        try {
          payload = JSON.parse(tokenPayload || "{}") as CompletionPayload;
        } catch {
          return;
        }
        const intentId = String(payload.intentId || "").trim();
        const pathname = String(payload.pathname || "");
        if (!intentId || !pathname || pathname !== blob.pathname) return;

        await getD1()
          .prepare(
            `UPDATE upload_intents SET status='uploaded',uploaded_at=?
             WHERE id=? AND storage_key=? AND status='pending' AND expires_at>?`,
          )
          .bind(Date.now(), intentId, pathname, Date.now())
          .run();
      },
    });
    return json(result);
  } catch (error) {
    if (error instanceof UploadRouteError)
      return json({ error: error.message }, error.status);
    console.error("Vercel Blob upload route failed", error);
    return json({ error: "GitNorm could not prepare that upload." }, 500);
  }
}
