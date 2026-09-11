/**
 * Shared types + constants for /admin/drinks (TOP SELLERS config), so the classic view
 * and the v2 view read from ONE definition (UX overhaul Beat 3).
 *
 * Lifted VERBATIM out of DrinksAdmin.tsx — same fields, same values, same meaning. The
 * page keeps every query and mutation; this file holds no behaviour.
 */

export interface AvailableGroup { toast_menu_guid: string; name: string; menu_name: string | null; }
export interface ConfiguredGroup { id: string; toast_menu_guid: string; name: string; enabled: boolean; display_order: number; }
export interface Config { header_text: string; footer_text: string; display_mode: string; auto_rotate_seconds: number; refresh_interval: number; }

/** The synthetic "everything" bucket the sync writes under MAIN_MENU_ALL. */
export const OVERALL = { toast_menu_guid: "MAIN_MENU_ALL", name: "Overall Top 5" };
