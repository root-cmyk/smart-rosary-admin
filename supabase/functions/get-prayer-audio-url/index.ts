
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const firebaseProjectId = Deno.env.get("FIREBASE_PROJECT_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");

    if (!firebaseProjectId || !supabaseUrl || !secretKeysJson) {
      console.error("Required server configuration is missing.");
      return jsonResponse({ error: "Audio service is not configured" }, 500);
    }

    // Verify the caller's Firebase ID token.
    const authHeader = req.headers.get("Authorization") ?? "";
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!tokenMatch) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }

    const firebaseToken = tokenMatch[1];

    const tokenInfoResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseProjectId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: firebaseToken }),
      },
    );

    // Firebase project ID is not an API key. Use securetoken verification below.
    // This endpoint is intentionally not used for authentication.
    if (!tokenInfoResponse.ok) {
      // Continue to the secure token verification step.
    }

    const parts = firebaseToken.split(".");
    if (parts.length !== 3) {
      return jsonResponse({ error: "Invalid authentication token" }, 401);
    }

    const decodeBase64Url = (value: string) => {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    };

    let header: { alg?: string; kid?: string };
    let claims: {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      auth_time?: number;
    };

    try {
      header = JSON.parse(decodeBase64Url(parts[0]));
      claims = JSON.parse(decodeBase64Url(parts[1]));
    } catch {
      return jsonResponse({ error: "Invalid authentication token" }, 401);
    }

    if (
      header.alg !== "RS256" ||
      !header.kid ||
      claims.aud !== firebaseProjectId ||
      claims.iss !== `https://securetoken.google.com/${firebaseProjectId}` ||
      !claims.sub ||
      !claims.exp ||
      !claims.iat ||
      !claims.auth_time ||
      claims.exp <= Math.floor(Date.now() / 1000)
    ) {
      return jsonResponse({ error: "Invalid authentication token" }, 401);
    }

    const jwksResponse = await fetch(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
    );

    if (!jwksResponse.ok) {
      return jsonResponse({ error: "Authentication service unavailable" }, 503);
    }

    const jwks = await jwksResponse.json();
    const jwk = jwks.keys?.find(
      (key: { kid?: string }) => key.kid === header.kid,
    );

    if (!jwk) {
      return jsonResponse({ error: "Invalid authentication token" }, 401);
    }

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const signature = Uint8Array.from(
      decodeBase64Url(parts[2]),
      (char) => char.charCodeAt(0),
    );

    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const validSignature = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signature,
      signedData,
    );

    if (!validSignature) {
      return jsonResponse({ error: "Invalid authentication token" }, 401);
    }

    const body = await req.json();
    const path = body?.path;

    if (typeof path !== "string" || !path.trim() || path.startsWith("/")) {
      return jsonResponse({ error: "A valid audio path is required" }, 400);
    }

    // Query Firestore using the authenticated user's Firebase token.
    // Only return audio for a published prayer whose audioPath matches.
    const firestoreUrl =
      `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents:runQuery`;

    const firestoreResponse = await fetch(firestoreUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${firebaseToken}`,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "prayers" }],
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: "audioPath" },
                    op: "EQUAL",
                    value: { stringValue: path },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: "published" },
                    op: "EQUAL",
                    value: { booleanValue: true },
                  },
                },
              ],
            },
          },
          limit: 1,
        },
      }),
    });

    if (!firestoreResponse.ok) {
      console.error("Firestore publication check failed:", firestoreResponse.status);
      return jsonResponse({ error: "Could not verify published prayer" }, 502);
    }

    const firestoreResults = await firestoreResponse.json();
    const prayerExists = Array.isArray(firestoreResults) &&
      firestoreResults.some(
        (item: { document?: { name?: string } }) => Boolean(item.document?.name),
      );

    if (!prayerExists) {
      return jsonResponse({ error: "Published prayer audio not found" }, 403);
    }

    // Parse the server-only Supabase secret key.
    let secretKeys: { default?: string };
    try {
      secretKeys = JSON.parse(secretKeysJson);
    } catch {
      return jsonResponse({ error: "Audio service is not configured" }, 500);
    }

    if (!secretKeys.default) {
      return jsonResponse({ error: "Audio service is not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, secretKeys.default, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.storage
      .from("prayer-audio")
      .createSignedUrl(path, 300);

    if (error || !data?.signedUrl) {
      console.error("Could not create signed audio URL:", error?.message);
      return jsonResponse({ error: "Could not prepare audio playback" }, 502);
    }

    return jsonResponse({
      signedUrl: data.signedUrl,
      expiresIn: 300,
    });
  } catch (error) {
    console.error(
      "get-prayer-audio-url failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return jsonResponse({ error: "Audio request failed" }, 500);
  }
});
