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
    hidden: false, remove() {},
    set textContent(v) { this._t = String(v); }, get textContent() { return this._t; },
    set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h || ""; },
    appendChild(c) { this.children.push(c); return c; },
    querySelector(s) { return (this._q || (this._q = {}))[s] || (this._q[s] = mkEl()); },
  };
}

/* Render once at a given moment. `query` drives the ?t= override; `nowMs` is
   what the device clock reads, which the page should ignore in favour of ET. */
function run(query, nowMs = Date.now()) {
  const byId = { cards: mkEl(), clock: mkEl(), sim: mkEl(), jswarn: mkEl() };
  const cardEls = {};                      // the page looks these up by data-key
  const sandbox = {
    document: {
      getElementById: (id) => byId[id] || (byId[id] = mkEl()),
      querySelector: (sel) => {
        const m = /data-key="([^"]+)"/.exec(sel);
        return m ? (cardEls[m[1]] || (cardEls[m[1]] = mkEl())) : mkEl();
      },
      createElement: mkEl, addEventListener() {}, hidden: false,
    },
    location: { search: query }, setInterval() {}, console, URLSearchParams, Intl,
    Date: class extends Date {
      constructor(...a) { a.length ? super(...a) : super(nowMs); }
      static now() { return nowMs; }
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(body, sandbox);
  const cards = {};
  for (const [key, el] of Object.entries(cardEls)) {
    const q = el._q;
    cards[key] = { num: q[".num"]._t, unit: q[".unit"]._t, lbl: q[".lbl"]._t,
                   dep: q[".dep"]._t, then: q[".then"]._t,
                   sprint: q[".sprint"].hidden ? "" : q[".sprint"]._t };
  }
  return { clock: byId.clock._t, jswarnHidden: byId.jswarn.hidden, cards };
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
  for (const [stop, c] of Object.entries(r.cards))
    console.log("   " + stop.padEnd(10) + (c.num + " " + c.unit).trim().padEnd(12) +
                c.lbl.padEnd(12) + c.dep.padEnd(22) + (c.sprint || c.then));
}

/* --- invariants ---------------------------------------------------------- */

// Sweep a whole service day: never "0 min", never later than the sprint window,
// and never a sprint at a stop with no walk to make up.
for (let m = 0; m < 24 * 60; m++) {
  const t = "2026-09-01T" + String((m / 60) | 0).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const cards = at(t).cards;
  for (const c of Object.values(cards)) assert.notStrictEqual(c.num, "0", "0 min at " + t);
  // A stop with no walk to make up can never be sprinted for.
  for (const stop of [BTA, LOMB]) assert.strictEqual(cards[stop].sprint, "", t);
  // Never offer a run for a bus more than SPRINT_MIN past the ideal departure.
  const m2 = /left (\d+) min ago/.exec(cards[DUPONT].sprint);
  if (m2) assert.ok(+m2[1] >= 1 && +m2[1] <= 5, cards[DUPONT].sprint + " at " + t);
}
// 15 min walk: at 11:59:30 PM the 12:10 AM bus is only reachable at a run, and
// there is no later one, so the board is off with the sprint still offered.
assert.match(at("2026-09-01T23:59:30").cards[DUPONT].num, /No service|—/);

// A service day that starts Tuesday morning still owns the 12:10 AM Wednesday bus.
assert.strictEqual(at("2026-09-01T23:45").cards[DUPONT].dep, "bus 12:10 AM");
// Friday 11:58 PM: the 12:10 AM bus is 12 minutes out and the walk is 15, so it
// is not walkable -- but a run still catches it, and missing it costs the weekend.
const fri = at("2026-09-04T23:58").cards[DUPONT];
assert.strictEqual(fri.dep, "Monday 6:20 AM");
assert.strictEqual(fri.sprint, "Run for 12:10 AM · left 3 min ago");
assert.strictEqual(at("2026-08-31T00:05").cards[DUPONT].num, "No service");     // Sunday has none

// The big number is always a bus reachable at a walk, never a sprint.
const peak = at("2026-09-01T08:10").cards[DUPONT];
assert.strictEqual(peak.num, "Now");
assert.strictEqual(peak.lbl, "leave in");
assert.strictEqual(peak.dep, "bus 8:25 AM");            // 15 min out, walkable
assert.strictEqual(peak.sprint, "Run for 8:20 AM · left 5 min ago");

// In the sparse midday hours the sprint is worth far more: running for the
// 10:45 saves the twenty-minute wait for the 11:05.
const midday = at("2026-09-01T10:32").cards[DUPONT];
assert.strictEqual(midday.dep, "bus 11:05 AM");
assert.strictEqual(midday.sprint, "Run for 10:45 AM · left 2 min ago");

// Once that bus is beyond the window the offer goes away.
assert.strictEqual(at("2026-09-01T10:36").cards[DUPONT].sprint, "");

// Weekends and the small hours fall back to the next scheduled departure.
for (const stop of [DUPONT, BTA, LOMB]) {
  assert.strictEqual(at("2026-09-05T11:00").cards[stop].num, "No service");
  assert.match(at("2026-09-05T11:00").cards[stop].dep, /^Monday /);
  assert.strictEqual(at("2026-09-02T00:35").cards[stop].num, "No service");
}

// The source's "12:25 AM" Lombardi cell is read as 12:25 PM, in sequence.
assert.strictEqual(at("2026-09-01T12:20").cards[LOMB].dep, "bus 12:25 PM");

// Times track America/New_York even when the device clock is set elsewhere.
process.env.TZ = "Asia/Tokyo";
const et7 = run("", Date.parse("2026-09-01T07:03:00-04:00"));      // 07:03 EDT
assert.strictEqual(et7.cards[BTA].dep, "bus 7:05 AM");
assert.strictEqual(et7.cards[LOMB].dep, "bus 7:10 AM");

// The no-JS notice is hidden only once the script has actually run.
assert.strictEqual(at("2026-09-01T08:12").jswarnHidden, true);

console.log("\nAll checks passed.");
