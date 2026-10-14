// Unit tests for exam-config.js (Node's built-in runner, no dependencies):
//   node --test tests/exam-config.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const X = require("../exam-config.js");

// Deterministic generator (mulberry32) as an injected randomInt.
function seeded(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (n) => Math.floor(next() * n);
}
// Scripted randomInt: returns the given values in turn (each must be < n).
function scripted(values) {
  let i = 0;
  return (n) => {
    const v = values[i++ % values.length];
    assert.ok(v >= 0 && v < n, `scripted value ${v} out of range for ${n}`);
    return v;
  };
}
const ids = (n) => Array.from({ length: n }, (_, i) => "q" + String(i + 1).padStart(4, "0"));
const bankOf = (n, mk) =>
  ids(n).map((id, i) => Object.assign(
    { id, question: "Question " + (i + 1), choice_a: "A" + i, choice_b: "B" + i, choice_c: "C" + i, choice_d: "D" + i, correct_choice: "abcd"[i % 4], explanation: "E" + i },
    mk ? mk(i) : {}
  ));
const assertUniqueSubset = (picked, pool) => {
  assert.equal(new Set(picked).size, picked.length, "no duplicates");
  const all = new Set(pool);
  picked.forEach((id) => assert.ok(all.has(id), "subset of the bank"));
};

// ---------------------------------------------------------------- config
test("config: life / health / combo are explicit all-bank, shuffled questions and choices", () => {
  for (const slug of ["life", "health", "life-health-combo"]) {
    const c = X.examConfigFor(slug);
    assert.deepEqual({ ...c }, { length: "all", shuffleQuestions: true, shuffleChoices: true, version: 1 }, slug);
  }
});

test("config: series-6 = 55, questions shuffled, choices in source order", () => {
  assert.deepEqual({ ...X.examConfigFor("series-6") }, { length: 55, shuffleQuestions: true, shuffleChoices: false, version: 1 });
});

test("config: series-63 = 65, questions shuffled, choices in source order", () => {
  assert.deepEqual({ ...X.examConfigFor("series-63") }, { length: 65, shuffleQuestions: true, shuffleChoices: false, version: 1 });
});

test("config: exactly the five approved courses are configured", () => {
  assert.deepEqual(Object.keys(X.EXAMS).sort(), ["health", "life", "life-health-combo", "series-6", "series-63"]);
});

test("config: unknown / unusual slugs are NOT configured (no implicit all-bank)", () => {
  for (const slug of ["sie", "series-65", "SERIES-6", " series-6", "", null, undefined, 6, "__proto__", "constructor", "toString", "hasOwnProperty"]) {
    assert.equal(X.examConfigFor(slug), null, String(slug));
  }
});

test("config: entries and the map are frozen", () => {
  assert.ok(Object.isFrozen(X.EXAMS));
  for (const slug of Object.keys(X.EXAMS)) assert.ok(Object.isFrozen(X.EXAMS[slug]), slug);
  const c = X.examConfigFor("series-6");
  assert.throws(() => { "use strict"; c.length = 900; }, TypeError);
  assert.throws(() => { "use strict"; X.EXAMS.sie = { length: "all" }; }, TypeError);
  assert.equal(X.examConfigFor("series-6").length, 55);
  assert.equal(X.examConfigFor("sie"), null);
});

// ---------------------------------------------------------------- slug handling
test("slug: missing, empty and blank mean no course; anything else is kept exactly", () => {
  assert.equal(X.requestedSlug(null), null);
  assert.equal(X.requestedSlug(undefined), null);
  assert.equal(X.requestedSlug(""), null);
  assert.equal(X.requestedSlug("   "), null);
  assert.equal(X.requestedSlug("series-6"), "series-6");
  assert.equal(X.requestedSlug("no-such-course"), "no-such-course");
  assert.equal(X.requestedSlug("life"), "life");
});

// ---------------------------------------------------------------- selection
test("selection: attemptSize uses the bank when smaller, the length otherwise, all = bank", () => {
  assert.equal(X.attemptSize({ length: "all" }, 0), 0);
  assert.equal(X.attemptSize({ length: "all" }, 412), 412);
  assert.equal(X.attemptSize({ length: 55 }, 0), 0);
  assert.equal(X.attemptSize({ length: 55 }, 37), 37);
  assert.equal(X.attemptSize({ length: 55 }, 55), 55);
  assert.equal(X.attemptSize({ length: 55 }, 900), 55);
  assert.equal(X.attemptSize({ length: 65 }, 364), 65);
});

test("selection: empty bank gives an empty attempt", () => {
  assert.deepEqual(X.selectQuestionIds([], 55, true, seeded(1)), []);
  assert.deepEqual(X.createAttempt([], X.examConfigFor("series-6"), seeded(1)).questionIds, []);
});

test("selection: bank smaller than, equal to and larger than the requested length", () => {
  for (const [n, k, want] of [[37, 55, 37], [55, 55, 55], [56, 55, 55], [900, 55, 55], [364, 65, 65]]) {
    const pool = ids(n);
    const before = pool.slice();
    const picked = X.selectQuestionIds(pool, X.attemptSize({ length: k }, n), true, seeded(n));
    assert.equal(picked.length, want, `${n} -> ${k}`);
    assertUniqueSubset(picked, pool);
    assert.deepEqual(pool, before, "input unchanged");
  }
});

test("selection: Series 6 style 900 -> 55 and Series 63 style 364 -> 65 via createAttempt", () => {
  for (const [slug, n, k] of [["series-6", 900, 55], ["series-63", 364, 65]]) {
    const bank = bankOf(n);
    const snapshot = JSON.stringify(bank);
    const a = X.createAttempt(bank, X.examConfigFor(slug), seeded(7));
    assert.equal(a.questionIds.length, k, slug);
    assertUniqueSubset(a.questionIds, bank.map((q) => q.id));
    assert.equal(JSON.stringify(bank), snapshot, "bank rows and order unchanged");
    // shuffled: not simply the first k in position order
    assert.notDeepEqual(a.questionIds, bank.slice(0, k).map((q) => q.id));
  }
});

test("selection: all-bank courses use every question exactly once", () => {
  const bank = bankOf(412);
  const a = X.createAttempt(bank, X.examConfigFor("life"), seeded(3));
  assert.equal(a.questionIds.length, 412);
  assert.deepEqual(a.questionIds.slice().sort(), bank.map((q) => q.id).sort());
});

test("selection: shuffle off returns the authoritative order", () => {
  const pool = ids(10);
  assert.deepEqual(X.selectQuestionIds(pool, 4, false, () => { throw new Error("no randomness expected"); }), pool.slice(0, 4));
  assert.deepEqual(X.selectQuestionIds(pool, 99, false), pool);
});

test("selection: injected RNG is deterministic; different seeds differ", () => {
  const pool = ids(900);
  const a = X.selectQuestionIds(pool, 55, true, seeded(42));
  const b = X.selectQuestionIds(pool, 55, true, seeded(42));
  const c = X.selectQuestionIds(pool, 55, true, seeded(43));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("selection: partial Fisher-Yates with scripted values gives the exact expected order", () => {
  // pool [p1..p5], k = 3: i=0 j=0+2 -> swap p1,p3; i=1 j=1+3 -> swap p2,p5; i=2 j=2+0
  const picked = X.selectQuestionIds(["p1", "p2", "p3", "p4", "p5"], 3, true, scripted([2, 3, 0]));
  assert.deepEqual(picked, ["p3", "p5", "p1"]);
});

test("selection: no positional bias (seeded frequency check)", () => {
  const n = 5, runs = 50000;
  const counts = Array.from({ length: n }, () => new Array(n).fill(0));
  const rand = seeded(2026);
  for (let r = 0; r < runs; r++) {
    X.selectQuestionIds([0, 1, 2, 3, 4], n, true, rand).forEach((v, pos) => counts[v][pos]++);
  }
  const expected = runs / n;
  counts.forEach((row) => row.forEach((c) => assert.ok(Math.abs(c - expected) < expected * 0.05, `count ${c} vs ${expected}`)));
});

test("selection: default RNG returns in-range integers and rejects bad input", () => {
  for (let i = 0; i < 2000; i++) {
    const v = X.defaultRandomInt(7);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 7);
  }
  assert.throws(() => X.defaultRandomInt(0), RangeError);
  assert.throws(() => X.defaultRandomInt(2.5), RangeError);
});

// ---------------------------------------------------------------- choices
test("choices: shuffle off returns a/b/c/d; shuffle on is deterministic with an injected RNG", () => {
  const q = bankOf(1)[0];
  assert.deepEqual(X.choiceOrder(q, false), ["a", "b", "c", "d"]);
  // Fisher-Yates from the end: i=3 j=0 -> [d,b,c,a]; i=2 j=0 -> [c,b,d,a]; i=1 j=0 -> [b,c,d,a]
  assert.deepEqual(X.choiceOrder(q, true, scripted([0, 0, 0])), ["b", "c", "d", "a"]);
  assert.deepEqual(X.choiceOrder(q, true, seeded(5)), X.choiceOrder(q, true, seeded(5)));
});

test("choices: all four source slots are kept even when a (malformed) fixture has blank text", () => {
  const q = { choice_a: "Yes", choice_b: "No", choice_c: null, choice_d: "  ", correct_choice: "a" };
  assert.deepEqual(X.choiceOrder(q, false), ["a", "b", "c", "d"]);
  const shuffled = X.choiceOrder(q, true, seeded(8));
  assert.equal(shuffled.length, 4);
  assert.deepEqual(shuffled.slice().sort(), ["a", "b", "c", "d"]);
  const odd = { choice_a: "Only", choice_b: "", choice_c: null, choice_d: undefined, correct_choice: "c" };
  assert.deepEqual(X.choiceOrder(odd, false), ["a", "b", "c", "d"]);
});

test("choices: Series 6 / 63 attempts keep every question in source a/b/c/d order", () => {
  for (const slug of ["series-6", "series-63"]) {
    const a = X.createAttempt(bankOf(400), X.examConfigFor(slug), seeded(11));
    a.questionIds.forEach((id) => assert.deepEqual(a.choiceOrders[id], ["a", "b", "c", "d"], `${slug} ${id}`));
  }
});

test("choices: legacy courses shuffle choices (some question differs from a/b/c/d)", () => {
  const a = X.createAttempt(bankOf(50), X.examConfigFor("health"), seeded(13));
  assert.ok(a.questionIds.some((id) => a.choiceOrders[id].join("") !== "abcd"));
  a.questionIds.forEach((id) => assert.deepEqual(a.choiceOrders[id].slice().sort(), ["a", "b", "c", "d"]));
});

test("labels: display letters come from display position; correct label resolves after a shuffle", () => {
  const order = ["c", "a", "d", "b"]; // display A=c, B=a, C=d, D=b
  assert.deepEqual([0, 1, 2, 3].map(X.displayLabel), ["A", "B", "C", "D"]);
  assert.equal(X.displayLabelFor(order, "c"), "A");
  assert.equal(X.displayLabelFor(order, "a"), "B");
  assert.equal(X.displayLabelFor(order, "d"), "C");
  assert.equal(X.displayLabelFor(order, "b"), "D");
  assert.equal(X.displayLabelFor(["a", "b"], "c"), null);
  assert.equal(X.displayLabelFor(["a", "b", "c", "d"], "b"), "B", "source order: display = source");
});

test("TTS: spoken choices follow the display order and display letters", () => {
  const q = { choice_a: "alpha", choice_b: "bravo", choice_c: "charlie", choice_d: "delta" };
  assert.deepEqual(X.spokenChoices(q, ["c", "a", "d", "b"]), ["A. charlie", "B. alpha", "C. delta", "D. bravo"]);
  assert.deepEqual(X.spokenChoices(q, ["a", "b", "c", "d"]), ["A. alpha", "B. bravo", "C. charlie", "D. delta"]);
});

// ---------------------------------------------------------------- grading / attempt
test("grading: keyed to the stored correct_choice, never to the display letter", () => {
  const bank = bankOf(8);
  const byId = new Map(bank.map((q) => [q.id, q]));
  const a = X.createAttempt(bank, X.examConfigFor("life"), seeded(99)); // shuffled questions and choices
  // Answer every question with its stored correct key, wherever it is displayed.
  a.questionIds.forEach((id) => { a.answers[id] = byId.get(id).correct_choice; });
  assert.deepEqual(X.scoreAttempt(a, byId), { correct: 8, total: 8, percent: 100 });
  // Answer with the key shown in display position A: right only where that is the stored answer.
  const b = X.createAttempt(bank, X.examConfigFor("life"), seeded(99));
  let expected = 0;
  b.questionIds.forEach((id) => {
    const shownFirst = b.choiceOrders[id][0];
    b.answers[id] = shownFirst;
    if (shownFirst === byId.get(id).correct_choice) expected++;
  });
  assert.equal(X.scoreAttempt(b, byId).correct, expected);
  // Never by the letter itself: answering "a" (display A) counts only when the stored answer is "a".
  const c = X.createAttempt(bank, X.examConfigFor("life"), seeded(99));
  c.questionIds.forEach((id) => { c.answers[id] = "a"; });
  assert.equal(X.scoreAttempt(c, byId).correct, bank.filter((q) => q.correct_choice === "a").length);
});

test("grading: unanswered counts as incorrect; percent rounds; empty attempt scores 0", () => {
  const bank = bankOf(3);
  const byId = new Map(bank.map((q) => [q.id, q]));
  const a = X.createAttempt(bank, X.examConfigFor("series-6"), seeded(1));
  a.answers[a.questionIds[0]] = byId.get(a.questionIds[0]).correct_choice;
  assert.deepEqual(X.scoreAttempt(a, byId), { correct: 1, total: 3, percent: 33 });
  assert.deepEqual(X.scoreAttempt({ questionIds: [], answers: {} }, byId), { correct: 0, total: 0, percent: 0 });
});

test("attempt: stable while navigating/checking; a new Start (Retake) builds a fresh attempt", () => {
  const bank = bankOf(900);
  const config = X.examConfigFor("series-6");
  const rand = seeded(2024);
  const a = X.createAttempt(bank, config, rand);
  const frozen = JSON.stringify({ q: a.questionIds, c: a.choiceOrders });
  // navigating and checking only touch currentIndex / answers / checked
  a.currentIndex = 10; a.answers[a.questionIds[10]] = "b"; a.checked[a.questionIds[10]] = true; a.currentIndex = 3;
  assert.equal(JSON.stringify({ q: a.questionIds, c: a.choiceOrders }), frozen);
  const b = X.createAttempt(bank, config, rand);
  assert.notDeepEqual(b.questionIds, a.questionIds, "retake reshuffles");
  assert.deepEqual(b.answers, {});
  assert.deepEqual(b.checked, {});
  assert.equal(b.currentIndex, 0);
});

test("attempt: holds ids and keys only (no question content)", () => {
  const a = X.createAttempt(bankOf(5), X.examConfigFor("life"), seeded(1));
  const json = JSON.stringify(a);
  assert.ok(!/Question 1|A0|E0/.test(json));
});

// ---------------------------------------------------------------- paging
function fakeTable(n) {
  // Rows deliberately created out of order; the fake "server" orders by position, then id.
  const rows = ids(n).map((id, i) => ({ id, position: n - i })).reverse();
  rows.sort((x, y) => x.position - y.position || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const calls = [];
  const fetchPage = async (from, to) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { rows, calls, fetchPage };
}

for (const n of [0, 999, 1000, 1001, 2500]) {
  test(`paging: ${n} rows load completely, in order, without duplicates`, async () => {
    const t = fakeTable(n);
    const out = await X.loadAllPages(t.fetchPage, 1000);
    assert.equal(out.length, n);
    assert.deepEqual(out.map((r) => r.id), t.rows.map((r) => r.id));
    assert.equal(new Set(out.map((r) => r.id)).size, n);
    const pages = Math.floor(n / 1000) + 1;
    assert.equal(t.calls.length, pages);
    t.calls.forEach(([from, to], i) => assert.deepEqual([from, to], [i * 1000, i * 1000 + 999]));
  });
}

test("paging: an error on any page stops loading (no partial bank)", async () => {
  let call = 0;
  const fetchPage = async (from, to) => {
    call++;
    if (call === 2) return { data: null, error: { message: "boom" } };
    return { data: ids(1000).map((id) => ({ id: from + id })), error: null };
  };
  await assert.rejects(X.loadAllPages(fetchPage, 1000), /boom/);
});

test("paging: a repeated id across pages is rejected", async () => {
  const fetchPage = async (from) => ({ data: from === 0 ? [{ id: "x" }, { id: "y" }] : [{ id: "y" }], error: null });
  await assert.rejects(X.loadAllPages(fetchPage, 2), /Duplicate/);
});
