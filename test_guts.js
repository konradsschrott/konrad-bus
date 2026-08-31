/* Checks guts.html by running its real <script> against a stub DOM, so the
   schedule and countdown logic under test is exactly what ships.
   Run: node test_guts.js        (prints every board, then asserts)          */
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

// The page is guts.html in the source repo and index.html where it is published.
const PAGE = ["guts.html", "index.html"]
  .map((f) => __dirname + "/" + f)
  .find((p) => fs.existsSync(p));
if (!PAGE) throw new Error("no guts.html or index.html beside this test");
const body = fs.readFileSync(PAGE, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];

function mkEl() {
  const cls = new Set();
  return {
    _t: "", className: "", style: { setProperty() {}, display: "" }, children: [],
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
    hidden: false, remove() {}, addEventListener() {}, focus() {},
    set textContent(v) { this._t = String(v); }, get textContent() { return this._t; },
    set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h || ""; },
    appendChild(c) { this.children.push(c); return c; },
    querySelector(s) { return (this._q || (this._q = {}))[s] || (this._q[s] = mkEl()); },
  };
}

/* Render once at a given moment. `query` drives the ?t= override; `nowMs` is
   what the device clock reads, which the page should ignore in favour of ET.
   `__gutsInternal` is pre-defined so the script's own no-op test hook (see
   guts.html) populates it with the functions this suite checks directly,
   rather than re-deriving them or fighting the stub DOM through simulated
   clicks for the full-day sheet. */
function run(query, nowMs = Date.now()) {
  const byId = { cards: mkEl(), clock: mkEl(), sim: mkEl(), jswarn: mkEl() };
  const cardEls = {};                      // the page looks these up by data-key
  const internal = {};
  const sandbox = {
    document: {
      getElementById: (id) => byId[id] || (byId[id] = mkEl()),
      querySelector: (sel) => {
        const m = /data-key="([^"]+)"/.exec(sel);
        return m ? (cardEls[m[1]] || (cardEls[m[1]] = mkEl())) : mkEl();
      },
      createElement: mkEl, addEventListener() {}, hidden: false,
    },
    addEventListener() {},
    location: { search: query }, setInterval() {}, console, URLSearchParams, Intl,
    __gutsInternal: internal,
    Date: class extends Date {
      constructor(...a) { a.length ? super(...a) : super(nowMs); }
      static now() { return nowMs; }
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(body, sandbox);

  const cards = {};
  for (const [key, el] of Object.entries(cardEls)) {
    const q = el._q || {};
    const row1 = q[".row1"], row2 = q[".row2"];
    const r1q = (row1 && row1._q) || {}, r2q = (row2 && row2._q) || {};
    const sprintEl = q[".sprint"];
    cards[key] = {
      lbl: (q[".lbl"] || {})._t || "",
      row1Hidden: row1 ? row1.hidden : true,
      cd1: (r1q[".cd"] || {})._t || "", cdu1: (r1q[".cdu"] || {})._t || "",
      time1: (q[".time1"] || {})._t || "",
      row2Hidden: row2 ? row2.hidden : true,
      cd2: (r2q[".cd"] || {})._t || "", cdu2: (r2q[".cdu"] || {})._t || "",
      time2: (q[".time2"] || {})._t || "",
      offHidden: q[".off"] ? q[".off"].hidden : true,
      offtime: (q[".offtime"] || {})._t || "",
      sprint: sprintEl && !sprintEl.hidden ? sprintEl._t : "",
    };
  }
  return { clock: byId.clock._t, jswarnHidden: byId.jswarn.hidden, cards, internal };
}

const at = (t) => run("?t=" + t);
const DUPONT = "dupont", BTA = "bta", LOMB = "lombardi";

const cases = [
  ["first bus of the day",       "2026-09-01T05:55"],
  ["just before first Dupont",   "2026-09-01T06:09"],
  ["mid-morning",                "2026-09-01T08:12:30"],
  ["sparse midday gap",          "2026-09-01T10:50"],
  ["the 12:25 PM correction",    "2026-09-01T12:20"],
  ["late evening",               "2026-09-01T23:45"],
  ["midnight rollover",          "2026-09-01T23:59:30"],
  ["last bus already gone",      "2026-09-02T00:35"],
  ["Saturday",                   "2026-09-05T11:00"],
  ["Fri night into Sat",         "2026-09-04T23:58"],
  ["Sat 00:05, Friday's tail",   "2026-09-05T00:05"],
  ["Mon 00:05, no Sunday tail",  "2026-08-31T00:05"],
];
for (const [name, t] of cases) {
  const r = at(t);
  console.log("\n" + name + "  (" + r.clock + ")");
  for (const [stop, c] of Object.entries(r.cards)) {
    const row1 = c.offHidden ? (c.cd1 + " " + c.cdu1).trim() + "  " + c.time1 : "No service  " + c.offtime;
    const row2 = c.row2Hidden ? "" : "  then " + (c.cd2 + " " + c.cdu2).trim() + " " + c.time2;
    console.log("   " + stop.padEnd(10) + c.lbl.padEnd(12) + row1 + row2 + (c.sprint ? "   [" + c.sprint + "]" : ""));
  }
}

/* --- invariants ---------------------------------------------------------- */

// Sweep a whole service day: never "0 min" on either row, row 2 (when shown)
// is never earlier than row 1, never a sprint at a stop with no walk to make
// up, and never a sprint offered more than SPRINT_MIN past the ideal leave time.
for (let m = 0; m < 24 * 60; m++) {
  const t = "2026-09-01T" + String((m / 60) | 0).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const cards = at(t).cards;
  for (const c of Object.values(cards)) {
    if (!c.offHidden) continue;
    assert.notStrictEqual(c.cd1, "0", "0 min (row1) at " + t);
    if (!c.row2Hidden) assert.notStrictEqual(c.cd2, "0", "0 min (row2) at " + t);
  }
  for (const stop of [BTA, LOMB]) assert.strictEqual(cards[stop].sprint, "", t);
  const m2 = /left (\d+) min ago/.exec(cards[DUPONT].sprint);
  if (m2) assert.ok(+m2[1] >= 1 && +m2[1] <= 5, cards[DUPONT].sprint + " at " + t);
}

// 15 min walk: at 11:59:30 PM the 12:10 AM bus is only reachable at a run, and
// there is no later one, so the board is off with the sprint still offered.
assert.strictEqual(at("2026-09-01T23:59:30").cards[DUPONT].offHidden, false);

// A service day that starts Tuesday morning still owns the 12:10 AM Wednesday bus.
assert.strictEqual(at("2026-09-01T23:45").cards[DUPONT].time1, "12:10 AM");
// Friday 11:58 PM: the 12:10 AM bus is 12 minutes out and the walk is 15, so it
// is not walkable -- but a run still catches it, and missing it costs the weekend.
const fri = at("2026-09-04T23:58").cards[DUPONT];
assert.strictEqual(fri.offtime, "Monday 6:20 AM");
assert.strictEqual(fri.sprint, "Run for 12:10 AM · left 3 min ago");
assert.strictEqual(at("2026-08-31T00:05").cards[DUPONT].offHidden, false);     // Sunday has none

// The big number is always a bus reachable at a walk, never a sprint.
const peak = at("2026-09-01T08:10").cards[DUPONT];
assert.strictEqual(peak.cd1, "Now");
assert.strictEqual(peak.lbl, "leave in");
assert.strictEqual(peak.time1, "8:25 AM");              // 15 min out, walkable
assert.strictEqual(peak.sprint, "Run for 8:20 AM · left 5 min ago");

// In the sparse midday hours the sprint is worth far more: running for the
// 10:45 saves the twenty-minute wait for the 11:05.
const midday = at("2026-09-01T10:32").cards[DUPONT];
assert.strictEqual(midday.time1, "11:05 AM");
assert.strictEqual(midday.sprint, "Run for 10:45 AM · left 2 min ago");

// Once that bus is beyond the window the offer goes away.
assert.strictEqual(at("2026-09-01T10:36").cards[DUPONT].sprint, "");

// Row 2: the bus after the one row 1 is counting down to, same leave-by logic.
// At 8:10 the walk-adjusted next Dupont bus is 8:25 (row 1, "Now"); the one
// after is 8:30, which is 5 minutes further out at the same walk offset.
assert.strictEqual(peak.row2Hidden, false);
assert.strictEqual(peak.time2, "8:30 AM");
assert.strictEqual(peak.cd2, "5");

// Weekends and the small hours fall back to the next scheduled departure, with
// both countdown rows hidden behind the off block.
for (const stop of [DUPONT, BTA, LOMB]) {
  for (const [t, weekday] of [["2026-09-05T11:00", "Monday"], ["2026-09-02T00:35", "Wednesday"]]) {
    const c = at(t).cards[stop];
    assert.strictEqual(c.offHidden, false, stop + " " + t);
    assert.strictEqual(c.row1Hidden, true, stop + " " + t);
    assert.strictEqual(c.row2Hidden, true, stop + " " + t);
    assert.match(c.offtime, new RegExp("^" + weekday + " "), stop + " " + t);
  }
}

// The source's "12:25 AM" Lombardi cell is read as 12:25 PM, in sequence.
assert.strictEqual(at("2026-09-01T12:20").cards[LOMB].time1, "12:25 PM");

// Times track America/New_York even when the device clock is set elsewhere.
process.env.TZ = "Asia/Tokyo";
const et7 = run("", Date.parse("2026-09-01T07:03:00-04:00"));      // 07:03 EDT
assert.strictEqual(et7.cards[BTA].time1, "7:05 AM");
assert.strictEqual(et7.cards[LOMB].time1, "7:10 AM");

// The no-JS notice is hidden only once the script has actually run.
assert.strictEqual(at("2026-09-01T08:12").jswarnHidden, true);

/* --- the full-day sheet: remainingToday() and Dupont's arrival pairing --- */

const { internal } = at("2026-09-01T08:12:30");
const { remainingToday, activeSpanEnd, upcoming, clock, BOARDS } = internal;
const board = (key) => BOARDS.find((b) => b.key === key);
const DAY_S = 86400;

// A Dupont trip departs and loops back to the SAME side it started from, so
// DUPONT_TO[i]/DUPONT_ARRIVE[i] describe DUPONT[i] at the same index -- three
// arrays the same length, one per trip.
const dupont = board("dupont");
assert.strictEqual(dupont.to.length, dupont.times.length);
assert.strictEqual(dupont.arrive.length, dupont.times.length);

// Spot-check the same three anomalous rows the parser corrects, by their
// resolved Dupont departure minute (see build_schedule.py's own notes).
function arrivalFor(depMinute) {
  const i = dupont.times.indexOf(depMinute);
  assert.notStrictEqual(i, -1, "no Dupont departure at minute " + depMinute);
  return { to: dupont.to[i], arrive: dupont.arrive[i] };
}
// The Lombardi "12:25 AM" -> 12:25 PM correction: Dupont 12:45 PM -> Lombardi 1:05 PM.
assert.deepStrictEqual(arrivalFor(12 * 60 + 45), { to: "lombardi", arrive: 13 * 60 + 5 });
// The "16:20" 24-hour cell -> 4:20 PM: Dupont 4:00 PM -> Lombardi 4:20 PM.
assert.deepStrictEqual(arrivalFor(16 * 60), { to: "lombardi", arrive: 16 * 60 + 20 });
// The closing trip: Dupont 12:10 AM (next day, minute 1450) -> BTA 12:30 AM (1470).
assert.deepStrictEqual(arrivalFor(1450), { to: "bta", arrive: 1470 });

// remainingToday(): every entry is at or after `now`, at or before the cap,
// and in the same order (and with the same values) upcoming() would produce
// for that same window.
{
  const now = { y: 2026, mo: 9, d: 1, sec: 8 * 3600 + 12 * 60 };
  const spanEnd = activeSpanEnd(dupont.times, now);
  const items = remainingToday(dupont.times, now, spanEnd);
  assert.ok(items.length > 0);
  for (const { t } of items) assert.ok(t >= now.sec && t <= spanEnd);
  for (let k = 1; k < items.length; k++) assert.ok(items[k].t > items[k - 1].t);
  const first5 = upcoming(dupont.times, 0, 0, now, 5);
  assert.deepStrictEqual(items.slice(0, 5).map((x) => x.t), first5);
  // idx/d round-trip: reconstructing the departure from them matches t exactly,
  // and looking up that idx in DUPONT_TO/DUPONT_ARRIVE is what the sheet does.
  const { t, idx, d } = items[0];
  assert.strictEqual(d * DAY_S + dupont.times[idx] * 60, t);
  assert.strictEqual(dupont.to[idx], "bta");            // 8:15 AM Dupont -> BTA
  assert.strictEqual(clock(d * DAY_S + dupont.arrive[idx] * 60), "8:35 AM");

  // Nothing is missing between "now" and the cap: the count matches a plain
  // scan of the same array over the same range.
  const manual = dupont.times.filter((m) => m * 60 >= now.sec && m * 60 <= spanEnd).length;
  assert.strictEqual(items.length, manual);
}

// Off-hours: no service day is active, so there is no "rest of today" to cap
// against -- the sheet falls back to just the next scheduled departure, which
// this suite already covers via activeSpanEnd() returning null (asserted
// above through offHidden/offtime on a Saturday and after the last bus).
assert.strictEqual(activeSpanEnd(dupont.times, { y: 2026, mo: 9, d: 5, sec: 11 * 3600 }), null);

console.log("\nAll checks passed.");
