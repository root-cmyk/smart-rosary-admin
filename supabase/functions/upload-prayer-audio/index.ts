
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const BUCKET = "prayer-audio";

const projectId = Deno.env.get("FIREBASE_PROJECT_ID")!;

const firebaseKeys = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    if (!projectId) {
      return json({ error: "Firebase project ID is not configured." }, 500);
    }

    const authorization = req.headers.get("Authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return json({ error: "Firebase authentication is required." }, 401);
    }

    const firebaseToken = match[1];

    // Verify the Firebase ID token's signature, issuer and audience.
    const { payload } = await jwtVerify(firebaseToken, firebaseKeys, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });

    const uid = payload.sub;

    if (!uid) {
      return json({ error: "Invalid Firebase user identity." }, 401);
    }

    // Confirm the signed-in user is an enabled Smart Rosary administrator.
    // Firestore rules must allow this user to read admins/{their UID}.
    const adminUrl =
      `https://firestore.googleapis.com/v1/projects/${projectId}` +
      `/databases/(default)/documents/admins/${encodeURIComponent(uid)}`;

    const adminResponse = await fetch(adminUrl, {
      headers: {
        Authorization: `Bearer ${firebaseToken}`,
      },
    });

    if (!adminResponse.ok) {
      return json({ error: "Administrator access could not be verified." }, 403);
    }

    const adminDocument = await adminResponse.json();
    const isEnabled =
      adminDocument.fields?.enabled?.booleanValue === true;

    if (!isEnabled) {
      return json({ error: "This account is not an enabled administrator." }, 403);
    }

    const form = await req.formData();
    const file = form.get("file");
    const prayerId = form.get("prayerId");

    if (!(file instanceof File)) {
      return json({ error: "Choose an audio file." }, 400);
    }

    if (typeof prayerId !== "string" || !prayerId.trim()) {
      return json({ error: "A prayer must be selected." }, 400);
    }

    if (!file.type.startsWith("audio/")) {
      return json({ error: "Only audio files are accepted." }, 400);
    }

    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      return json({ error: "Audio must be between 1 byte and 20 MB." }, 400);
    }

    // Supabase injects the server-side secret keys into the function.
    // Never expose these keys to React or Flutter.
    const secretKeys = JSON.parse(
      Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"
    );

    const supabaseSecretKey = secretKeys.default;

    if (!supabaseSecretKey) {
      return json({ error: "Supabase server-side secret is unavailable." }, 500);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      supabaseSecretKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const safeFileName = file.name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-120) || "recording.mp3";

    const objectPath =
      `${uid}/${crypto.randomUUID()}-${safeFileName}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase Storage upload error:", uploadError.message);
      return json({ error: "Storage upload failed. Check the bucket configuration." }, 500);
    }

    return json({
      success: true,
      path: objectPath,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      prayerId: prayerId.trim(),
    });
  } catch (error) {
    console.error("Upload function error:", error);
    return json({ error: "Authentication or upload failed." }, 401);
  }
});
