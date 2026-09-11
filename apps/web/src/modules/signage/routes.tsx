// Signage staff surfaces (staff+, has_module('signage')) — the consolidated hub
// (docs/signage-hub-consolidation-mockup.html). The Events & Broadcast tabs retired into
// the hub; EditRotation is now a thin legacy-bookmark redirect into the hub's QUEUE slide-over.
export { SignageHub } from "./SignageHub";
export { EditRotation } from "./EditRotation";

// MEDIA promoted to its own top-level section (UX overhaul Beat 4) — v2 only; on a classic
// device each of these redirects to the hub anchor that still holds that surface. They ride
// THIS chunk deliberately: they mount the hub's own media panels and slide-overs.
export { MediaLibrary, MediaPlaylists, MediaScreens } from "./MediaPages";

// NB: the public rendered slot page (/signage/s/:slug, built in Phase 5 task 1) deliberately
// does NOT live here — it is exported from ./displayRoutes so the bar TVs never download the
// staff console as dead code. Read that file's header before moving anything across the line.
