// Signage staff surfaces (staff+, has_module('signage')) — the consolidated hub
// (docs/signage-hub-consolidation-mockup.html). The Events & Broadcast tabs retired into
// the hub; EditRotation is now a thin legacy-bookmark redirect into the hub's QUEUE slide-over.
export { SignageHub } from "./SignageHub";
export { EditRotation } from "./EditRotation";

// The public rendered slot page (/signage/s/:slug) — built in Phase 5 task 1.
export { SlotDisplay } from "./SlotDisplay";
