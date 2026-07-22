# Screen Install Checklist

*One page. Do this once per TV when mounting or replacing it.*

1. **Open a browser** on the TV (or the stick/box driving it) and go to the screen's **signage slot** URL — one slot per TV:
   - Portrait TV → `os.bunkerokc.com/signage/s/portrait-main`
   - Landscape TV → `os.bunkerokc.com/signage/s/landscape-bar`
   - Each slot runs everything on that screen: the rotation (specials, promos, media), takeovers, and — when the host **arms trivia** in Scoring — the live trivia boards. There are no separate trivia/standings/drinks TV URLs anymore.
   - `os.bunkerokc.com/game/preview` is the host's off-screen preview of the trivia boards — **never point a TV at it.**
2. **Set the TV picture mode** to **Just Scan / 1:1 / Screen Fit** — NOT any "zoom" or "16:9 stretch" mode. This stops the edges being cut off.
3. **Set the browser to fullscreen / kiosk** and disable screen-saver / sleep on the TV.
4. **Calibrate the fit:** add `?calibrate` to the URL (e.g. `/signage/s/portrait-main?calibrate`). A framed test pattern appears. Adjust the TV's picture size until the frame's edges sit just inside the panel, and note any inset shown on screen.
5. **Remove `?calibrate`** (reload the plain URL). The screen is now running.
6. **Confirm orientation:** rotate the physical TV to match its slot — the `portrait-main` slot is **portrait**, the `landscape-bar` slot is **landscape**.
7. **Leave it on.** The screen reloads itself nightly (~4 AM) and reconnects on its own after any network blip.

**Test:** from the host device, change something (start a game, show a question) and confirm this screen updates within a second. If it doesn't, refresh the TV once.
