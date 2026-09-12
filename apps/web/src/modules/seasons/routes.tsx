// Season management (docs/06). Admin only. Built in Phase 4.
//
// Wrapped in `withTriviaVersion` (polish arc 2, PR 3): SEASONS is one of the five
// trivia staff pages the `bunker.trivia_ui_version` switch governs, even though it
// lives in its own module and its own nav slot. The wrapper is a no-op — classic,
// byte for byte — unless BOTH device switches read v2.
import { withTriviaVersion } from "../trivia/triviaVersion";
import { SeasonsAdmin as SeasonsAdminPage } from "./SeasonsAdmin";

export const SeasonsAdmin = withTriviaVersion(SeasonsAdminPage);
