// emailTheme.ts — shared BUNKER UNIFIED OS email look, used by edge functions
// (invite-staff, invite-team-member) AND mirrored by the static Supabase auth
// templates in supabase/email-templates/*.html so every email the platform sends
// reads as one system.
//
// Constraints (email clients are hostile): table-based layout, ALL styling inline,
// no <style> blocks, no webfonts (brand fonts are desktop-licensed only — system
// monospace stack), no external images (clients block them — text wordmark, not the
// SVG roundel). Near-black bg #0d0f12, amber #ffb000 headers, green #33ff33 accents.
// In-world voice (SHELTER AUTHORITY / BUNKER UNIFIED OS) — original IP only.
//
// Keep this visually in sync with scripts/apply-email-templates.ts's static files;
// the static ones carry Go-template variables ({{ .Token }} etc.) that only Supabase
// injects, so they can't be generated from here — they're hand-matched.

const BG = "#0d0f12";
const CARD = "#12151a";
const BORDER = "#1f2630";
const AMBER = "#ffb000";
const GREEN = "#33ff33";
const TEXT = "#c8ccd0";
const MUTED = "#6b7280";
const MONO = "'Courier New', Courier, monospace";

export interface EmailOptions {
  /** Amber section heading, e.g. "STAFF ACCESS GRANTED". */
  heading: string;
  /** One or two short intro paragraphs (plain strings; each becomes a <p>). */
  intro: string[];
  /** Optional big monospace code block (e.g. a 6-digit OTP). */
  code?: string;
  /** Optional call-to-action button. */
  button?: { label: string; url: string };
  /** Optional plain-URL fallback line shown under the button. */
  fallbackUrl?: string;
  /** Closing "wasn't you?" style note (defaults to a generic ignore line). */
  footerNote?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build a full, email-client-safe HTML document for one transactional email. */
export function renderEmail(opts: EmailOptions): string {
  const footerNote = opts.footerNote ??
    "Didn't expect this? You can safely ignore this email — no action is taken.";

  const introHtml = opts.intro
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${TEXT};font-family:${MONO}">${esc(p)}</p>`)
    .join("");

  const codeHtml = opts.code
    ? `<div style="margin:20px 0;padding:16px;background:#000000;border:1px solid ${BORDER};text-align:center">
         <div style="font-size:32px;letter-spacing:8px;color:${AMBER};font-family:${MONO};font-weight:bold">${esc(opts.code)}</div>
       </div>`
    : "";

  const buttonHtml = opts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0"><tr><td bgcolor="${GREEN}" style="border-radius:2px">
         <a href="${opts.button.url}" style="display:inline-block;padding:13px 26px;font-size:16px;font-weight:bold;color:#000000;text-decoration:none;font-family:${MONO};letter-spacing:1px">${esc(opts.button.label)}</a>
       </td></tr></table>`
    : "";

  const fallbackHtml = opts.fallbackUrl
    ? `<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:${MUTED};font-family:${MONO}">Button not working? Paste this link into your browser:<br><span style="color:${GREEN};word-break:break-all">${esc(opts.fallbackUrl)}</span></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:${CARD};border:1px solid ${BORDER};border-radius:4px">
      <tr><td style="padding:26px 30px 8px">
        <div style="font-size:11px;letter-spacing:3px;color:${GREEN};font-family:${MONO}">SHELTER AUTHORITY</div>
        <div style="font-size:19px;letter-spacing:2px;color:${AMBER};font-family:${MONO};font-weight:bold;margin-top:2px">BUNKER UNIFIED OS</div>
      </td></tr>
      <tr><td style="padding:0 30px"><div style="border-top:1px solid ${BORDER};margin:14px 0"></div></td></tr>
      <tr><td style="padding:4px 30px 26px">
        <h1 style="margin:0 0 16px;font-size:20px;letter-spacing:1px;color:${AMBER};font-family:${MONO}">${esc(opts.heading)}</h1>
        ${introHtml}
        ${codeHtml}
        ${buttonHtml}
        ${fallbackHtml}
        <div style="border-top:1px solid ${BORDER};margin:22px 0 14px"></div>
        <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};font-family:${MONO}">${esc(footerNote)}</p>
      </td></tr>
    </table>
    <div style="max-width:480px;margin:14px auto 0;font-size:11px;color:${MUTED};font-family:${MONO};text-align:center">Bunker Club · 433 NW 23rd St · Oklahoma City</div>
  </td></tr>
</table>
</body></html>`;
}
