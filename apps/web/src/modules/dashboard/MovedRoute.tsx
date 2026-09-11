import { Navigate } from "react-router-dom";
import { useUiVersion } from "@/shared/useUiVersion";
import { InlineNotice, StaffPageHeader } from "@/shared/ui";

/**
 * A retired staff path (audit finding #6). CLASSIC keeps the silent `<Navigate>` it has
 * always had — RULE #1, no classic-visible change. v2 renders a small page saying where
 * the tool went, with a link that lands on the right section of the hub.
 */
export function MovedRoute({
  eyebrow,
  title,
  message,
  to,
  label,
}: {
  eyebrow: string;
  title: string;
  message: string;
  /** Where the tool lives now (also the classic redirect target's page). */
  to: string;
  label: string;
}) {
  const [version] = useUiVersion();
  if (version !== "v2") return <Navigate to="/signage" replace />;
  return (
    // `data-st-page` = the token sheet's opt-in hook; this branch is v2-only.
    <div className="sv2-page" data-st-page="">
      <div className="sv2-page-inner">
        <StaffPageHeader eyebrow={eyebrow} title={title} tag="MOVED" />
        <InlineNotice message={message} to={to} label={label} />
      </div>
    </div>
  );
}

/** The two retired signage tabs, as route elements (no props — App.tsx lazy-loads them). */
export function BroadcastMoved() {
  return (
    <MovedRoute
      eyebrow="BAR OPS ▸ BROADCAST"
      title="BROADCAST MOVED"
      message="BROADCAST moved into the SIGNAGE HUB — it is the TAKEOVER button on each screen card."
      to="/signage#screens"
      label="GO TO SCREENS →"
    />
  );
}

export function EventsMoved() {
  return (
    <MovedRoute
      eyebrow="BAR OPS ▸ EVENTS & PROMOS"
      title="EVENTS & PROMOS MOVED"
      message="EVENTS & PROMOS moved into the SIGNAGE HUB — promos and events live there as slide-overs."
      to="/signage#events"
      label="GO TO EVENTS →"
    />
  );
}
