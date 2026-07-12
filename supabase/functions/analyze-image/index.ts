// analyze-image — Gemini 2.5 Flash vision for picture-round answer extraction (docs/04).
// Ported from the legacy trivia export. Called by BulkImport with a base64 image; returns
// { text } where text is JSON { answers: string[] }. Keeps GEMINI_API_KEY server-side.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
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
