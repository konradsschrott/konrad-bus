# GUTS Dupont shuttle countdown

Minutes until the next Georgetown GUTS Dupont Circle shuttle, at each of the
three stops. One self-contained page, no dependencies, no build step, and no
network calls once it has loaded — it works in airplane mode.

**Live:** https://konradsschrott.github.io/konrad-bus/

## Add it to the iPhone home screen

Open the link in **Safari** (not Chrome — only Safari can install), then
Share → **Add to Home Screen**. It launches full-screen with its own icon, and
works from then on with no signal: a service worker caches the page on first
load.

## What each card shows

The countdown is the time until you should **leave**, not until the bus
arrives, because `WALK_MIN` puts Dupont 15 minutes from the door. It always
tracks the first bus you can still catch at a walk. When an earlier one is
within `SPRINT_MIN` of being reachable, it is offered on its own line:

```
  18  min   LEAVE IN
            bus 11:05 AM
  Run for 10:45 AM · left 2 min ago
```

Worth five minutes during peak headways, twenty in the sparse midday hours, and
at 11:58 PM on a Friday the difference between the last bus and Monday morning.

Both constants are at the top of the `<script>` in `index.html`. Set a stop's
walk to 0 to count down to the bus itself instead.

Colours: green above 5 minutes, amber 2–5, red below 2. It says "Now" or
"1 min", never "0 min". Outside service hours or at the weekend a board reads
"No service" and gives the next scheduled departure.

## Files

| | |
|---|---|
| `index.html` | The page. Everything is in here. |
| `sw.js` | Service worker — caches the page so it opens with no network. |
| `manifest.webmanifest` | Makes it installable, with the icon and colours. |
| `schedule.txt` | The published weekday timetable, verbatim — errors and all. |
| `build_schedule.py` | Turns `schedule.txt` into the arrays inside `index.html`. |
| `test_guts.js` | Runs the page's own script against a stub DOM and asserts. |

## Updating the timetable

The timetable is static, so it cannot know about delays or the service changes
GUTS posts as news items. Re-check it when the semester starts:

1. Copy the table from https://transportation.georgetown.edu/guts/dupont/ into
   `schedule.txt`, keeping the five columns.
2. `python3 build_schedule.py` — it prints the three arrays on stdout and every
   correction it made on stderr. Paste the arrays into `index.html`.
3. `node test_guts.js` to check nothing broke.
4. Bump `CACHE` in `sw.js` (e.g. `guts-v2`) so installed copies pick up the new
   page instead of serving the old one from cache.

`build_schedule.py` resolves each cell against the run of times around it and
keeps the reading that steps forward the least, rather than patching rows by
index. That one rule handles the published table's own errors: a stray
`12:25 AM` sitting between 11:45 AM and 1:05 PM reads as 12:25 PM, and the
closing `12:10 AM` belongs to the previous service day. A 24-hour cell such as
`16:20` is parsed as written.

## Testing

`node test_guts.js` extracts the real `<script>` from the page and runs it
against a stub DOM, so what is tested is what ships. Covers the first and last
bus, midnight rollover both ways, weekends, the Friday-night tail, the sprint
window, and timezone independence.

Times are computed against `America/New_York`, not the device zone, so the page
stays right if the phone's timezone is wrong. Add `?t=2026-09-01T07:03` to the
URL to override "now" and check any of those cases by hand.
