import type { ModuleKey, StaffRole } from "@/shared/useRole";

/**
 * Types + constants shared by the two /admin/users presentations (classic table and
 * the Beat 2 v2 view). Extracted so the v2 view can import them without importing the
 * page component (a cycle) — the DATA LAYER and every mutation still live in exactly
 * one place, `Users.tsx`. Nothing here changed behaviour when it moved.
 */

export const ALL_MODULES: ModuleKey[] = ["trivia", "seasons", "drinks", "signage", "website", "events"];

export type InviteRole = "staff" | "host";
export type InviteStatus = "invited" | "already-staff" | "already-admin" | "error";
export interface InviteResult { email: string; status: InviteStatus; detail?: string }

export interface StaffRow { profile_id: string; email: string; role: StaffRole; modules: ModuleKey[]; is_self: boolean }

/** Split a free-text address list on commas / whitespace / semicolons / newlines. */
export function parseEmails(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

export const STATUS_LABEL: Record<InviteStatus, string> = {
  invited: "✓ invited — sign-in link emailed",
  "already-staff": "✓ already staff — grants updated, link emailed",
  "already-admin": "• already an admin — link emailed, grants left as-is",
  error: "⚠ error",
};
