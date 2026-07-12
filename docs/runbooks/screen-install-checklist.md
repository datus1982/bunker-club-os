# Screen Install Checklist

*One page. Do this once per TV when mounting or replacing it.*

1. **Open a browser** on the TV (or the stick/box driving it) and go to the screen's URL:
   - Big landscape trivia TV → `os.bunkerokc.com/game-display`
   - Standings TV → `os.bunkerokc.com/leaderboard`
   - Drinks board → `os.bunkerokc.com/drinks`
   - Signage slot → `os.bunkerokc.com/signage/s/<slug>` *(Phase 3)*
2. **Set the TV picture mode** to **Just Scan / 1:1 / Screen Fit** — NOT any "zoom" or "16:9 stretch" mode. This stops the edges being cut off.
3. **Set the browser to fullscreen / kiosk** and disable screen-saver / sleep on the TV.
4. **Calibrate the fit:** add `?calibrate` to the URL (e.g. `/leaderboard?calibrate`). A framed test pattern appears. Adjust the TV's picture size until the frame's edges sit just inside the panel, and note any inset shown on screen.
5. **Remove `?calibrate`** (reload the plain URL). The screen is now running.
6. **Confirm orientation:** the standings screen is **portrait**, the trivia and drinks screens are **landscape**. Rotate the physical TV if needed.
7. **Leave it on.** The screen reloads itself nightly (~4 AM) and reconnects on its own after any network blip.

**Test:** from the host device, change something (start a game, show a question) and confirm this screen updates within a second. If it doesn't, refresh the TV once.
