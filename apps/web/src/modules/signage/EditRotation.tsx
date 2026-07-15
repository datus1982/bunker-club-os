import { useParams } from "react-router-dom";
import { SignageHub } from "./SignageHub";

/**
 * /signage/screens/:slug — LEGACY bookmark support.
 *
 * The per-screen EDIT ROTATION page is gone: the hub-consolidation folded the live-queue
 * editor into the hub's QUEUE slide-over (docs/signage-hub-consolidation-mockup.html, task 2).
 * This route now renders the hub with that screen's QUEUE slide-over already open, and the hub
 * normalizes the URL back to /signage (so a stale bookmark still lands a manager in the right
 * place without leaving them on a dead sub-route).
 */
export function EditRotation() {
  const { slug = "" } = useParams();
  return <SignageHub openQueueSlug={slug} />;
}
