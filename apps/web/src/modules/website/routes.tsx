import { Home as HomePage } from "./pages/Home";
import { Visit as VisitPage } from "./pages/Visit";
import { About as AboutPage } from "./pages/About";
import { Menu as MenuPage } from "./pages/Menu";
import { Events as EventsPage } from "./pages/Events";
import { Trivia as TriviaPage } from "./pages/Trivia";
import { History as HistoryPage } from "./pages/History";

/**
 * Public marketing website (docs/14) — Phase 3.5. Owns the site root; every route
 * here renders with zero auth. Read-views over data the OS already maintains
 * (live menu, events/promotions, public standings).
 *
 * Task 2: the live-data pages — /menu (public_menu), /events (public_events +
 * website-flagged signage), /trivia (season_leaderboard) — now built.
 */
export const Home = () => <HomePage />;
export const Visit = () => <VisitPage />;
export const About = () => <AboutPage />;
export const Menu = () => <MenuPage />;
export const Events = () => <EventsPage />;
export const Trivia = () => <TriviaPage />;
export const History = () => <HistoryPage />;
