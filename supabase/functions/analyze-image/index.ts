// analyze-image — Gemini 2.5 Flash vision for picture-round answer extraction (docs/04).
// Ported from the legacy trivia export. Called by BulkImport with a base64 image; returns
// { text } where text is JSON { answers: string[] }. Keeps GEMINI_API_KEY server-side.
//
// AUTH (Phase 1 close-out): the legacy port accepted ANY caller bearing the public anon
// key, so anyone could burn the owner's Gemini quota. This now requires a real user JWT
// AND a staff/host/admin row in venue_staff before it will touch Gemini:
//   1. gateway verify_jwt rejects unsigned/expired tokens (deploy flag);
//   2. auth.getUser() rejects the anon key (no `sub`) and any non-user token;
//   3. a service-role lookup confirms the caller is venue staff.
// The client must send the signed-in user's access_token, not the anon key.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Any staff tier may run OCR (admin ⊇ host ⊇ staff, docs/01).
const ALLOWED_ROLES = ["staff", "host", "admin"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    // ── AuthN: a valid, non-anon user JWT must be present ────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing bearer token" }, 401);
    }
    const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await authed.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    // ── AuthZ: caller must be venue staff (host/admin/staff) ──────────────────
    // Service role bypasses RLS to read the role for the authenticated uid only.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: staff, error: staffErr } = await admin
      .from("venue_staff")
      .select("role")
      .eq("profile_id", user.id)
      .in("role", ALLOWED_ROLES)
      .limit(1)
      .maybeSingle();
    if (staffErr) {
      return json({ error: "Authorization check failed" }, 500);
    }
    if (!staff) {
      return json({ error: "Staff role required" }, 403);
    }

    // ── Work ─────────────────────────────────────────────────────────────────
    const { image, prompt, mimeType } = await req.json();
    if (!image || !prompt) {
      return json({ error: "Missing image or prompt" }, 400);
    }
    if (!GEMINI_API_KEY) {
      return json({ error: "GEMINI_API_KEY not configured" }, 500);
    }

    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mimeType || "image/png", data: image } }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1000,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: { answers: { type: "ARRAY", items: { type: "STRING" } } },
              required: ["answers"],
            },
          },
        }),
      },
    );

    if (!res.ok) {
      const details = await res.text();
      return json({ error: "Gemini API request failed", details }, 500);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return json({ text }, 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}
