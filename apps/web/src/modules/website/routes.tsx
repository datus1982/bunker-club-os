import { Placeholder } from "@/shared/Placeholder";

import { Home as HomePage } from "./pages/Home";
import { Visit as VisitPage } from "./pages/Visit";
import { About as AboutPage } from "./pages/About";

/**
 * Public marketing website (docs/14) — Phase 3.5. Owns the site root; every route
 * here renders with zero auth. Read-views over data the OS already maintains
 * (live menu, events/promotions, public standings).
 *
 * Task 1 (this build): the foundation — design system, chrome, and the `/`,
 * `/visit`, `/about` pages. Menu / Events / Trivia stay as scaffolding stubs and
 * land in task 2.
 */
export const Home = () => <HomePage />;
export const Visit = () => <VisitPage />;
export const About = () => <AboutPage />;

export const Menu = () => <Placeholder title="MENU" phase="Phase 3.5 (docs/14) — task 2" />;
export const Events = () => <Placeholder title="EVENTS" phase="Phase 3.5 (docs/14) — task 2" />;
export const Trivia = () => <Placeholder title="TRIVIA" phase="Phase 3.5 (docs/14) — task 2" />;
