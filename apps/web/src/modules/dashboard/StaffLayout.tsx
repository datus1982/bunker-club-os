import { useUiVersion } from "@/shared/useUiVersion";
import { StaffLayoutClassic } from "./StaffNav";
import { StaffShellV2 } from "./StaffShellV2";

/**
 * The staff layout route element (UX overhaul Beat 1).
 *
 * One job: pick the shell this DEVICE opted into. `classic` (the default, and what
 * everyone gets until they press TRY THE NEW LAYOUT) renders the shipped StaffNav
 * shell unchanged; `v2` renders StaffShellV2.
 *
 * The branch lives here, in a parent, rather than as an early return inside either
 * shell: the two shells call different hooks, so flipping the switch must swap
 * COMPONENT TYPES (clean unmount/mount) instead of changing one component's hook order.
 */
export function StaffLayout() {
  const [version] = useUiVersion();
  return version === "v2" ? <StaffShellV2 /> : <StaffLayoutClassic />;
}
