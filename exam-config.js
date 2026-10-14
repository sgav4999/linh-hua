// Practice exam configuration and attempt logic. Data and pure functions
// only: no DOM, no Supabase client, no question content.
//
// Every course with a practice exam needs an explicit entry here. A course
// without one gets no exam (practice-exam.js shows "not configured yet"), so
// a new course with a large question bank can never fall into an all-bank
// exam by accident.
//
// Entry fields:
//   length            "all" or a positive whole number of questions per attempt
//                     (a bank smaller than this uses every question it has)
//   shuffleQuestions  pick and order questions randomly for each attempt;
//                     false keeps the authoritative order (position, then id)
//   shuffleChoices    show each question's choices in a random order; false
//                     keeps the stored a/b/c/d order (explanations may refer
//                     to a choice by its stored letter)
//   version           bump when an entry changes (for future saved attempts)
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LinhExamConfig = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function freezeEntry(entry) {
    return Object.freeze(Object.assign({}, entry));
  }

  const EXAMS = Object.freeze({
    life: freezeEntry({ length: "all", shuffleQuestions: true, shuffleChoices: true, version: 1 }),
    health: freezeEntry({ length: "all", shuffleQuestions: true, shuffleChoices: true, version: 1 }),
    "life-health-combo": freezeEntry({ length: "all", shuffleQuestions: true, shuffleChoices: true, version: 1 }),
    // Practice session lengths only. A real Series 6 sitting has 55 items
    // (50 scored + 5 unidentified pretest) and Series 63 has 65 (60 + 5);
    // here every selected question counts toward the practice score, with no
    // pass mark or time limit.
    "series-6": freezeEntry({ length: 55, shuffleQuestions: true, shuffleChoices: false, version: 1 }),
    "series-63": freezeEntry({ length: 65, shuffleQuestions: true, shuffleChoices: false, version: 1 }),
  });

  const SOURCE_KEYS = Object.freeze(["a", "b", "c", "d"]);
  const DISPLAY_LABELS = Object.freeze(["A", "B", "C", "D"]);

  // The entry for a course slug, or null when the course has no practice exam.
  function examConfigFor(slug) {
    if (typeof slug !== "string" || !Object.prototype.hasOwnProperty.call(EXAMS, slug)) return null;
    return EXAMS[slug];
  }

  // Missing, empty or blank ?course means no course was chosen; any other
  // value is looked up exactly as given.
  function requestedSlug(raw) {
    if (typeof raw !== "string" || raw.trim() === "") return null;
    return raw;
  }

  // Uniform whole number in [0, n). crypto.getRandomValues with rejection
  // sampling (no modulo bias); Math.random where crypto is unavailable.
  function defaultRandomInt(n) {
    if (!(Number.isInteger(n) && n > 0)) throw new RangeError("randomInt needs a positive integer");
    const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
    if (c && typeof c.getRandomValues === "function") {
      const limit = Math.floor(0x100000000 / n) * n;
      const buf = new Uint32Array(1);
      do c.getRandomValues(buf); while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  // Number of questions an attempt uses for a bank of bankSize questions.
  function attemptSize(config, bankSize) {
    if (config.length === "all") return bankSize;
    return Math.min(config.length, bankSize);
  }

  // Picks the attempt's question ids from the bank's ids (given in the
  // authoritative order). Partial Fisher-Yates over a copy: every id appears
  // at most once, every subset and order is equally likely, and the input is
  // never changed. With shuffle off, the first `count` ids in order.
  function selectQuestionIds(ids, count, shuffle, randomInt) {
    const pool = ids.slice();
    const k = Math.max(0, Math.min(count, pool.length));
    if (!shuffle) return pool.slice(0, k);
    const rand = randomInt || defaultRandomInt;
    for (let i = 0; i < k; i++) {
      const j = i + rand(pool.length - i);
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    return pool.slice(0, k);
  }

  // The four stored choice keys in display order: a/b/c/d, or those same four
  // shuffled. Every question keeps all four answer slots, whatever their text.
  function choiceOrder(question, shuffle, randomInt) {
    const keys = SOURCE_KEYS.slice();
    if (!shuffle) return keys;
    const rand = randomInt || defaultRandomInt;
    for (let i = keys.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      const t = keys[i];
      keys[i] = keys[j];
      keys[j] = t;
    }
    return keys;
  }

  // Display letter for a display position (0 -> "A").
  function displayLabel(index) {
    return DISPLAY_LABELS[index];
  }

  // Display letter of a stored choice key within a shown order, or null.
  function displayLabelFor(order, sourceKey) {
    const i = order.indexOf(sourceKey);
    return i === -1 ? null : DISPLAY_LABELS[i];
  }

  // "A. text" for each choice, in the order shown (for the Listen button).
  function spokenChoices(question, order) {
    return order.map((key, i) => DISPLAY_LABELS[i] + ". " + question["choice_" + key]);
  }

  // A new attempt from the bank (rows in the authoritative order). Choice
  // orders are fixed here, once per attempt; answers and checks hold stored
  // choice keys keyed by question id.
  function createAttempt(bank, config, randomInt) {
    const ids = bank.map((q) => q.id);
    const questionIds = selectQuestionIds(ids, attemptSize(config, ids.length), config.shuffleQuestions, randomInt);
    const byId = new Map(bank.map((q) => [q.id, q]));
    const choiceOrders = {};
    questionIds.forEach((id) => {
      choiceOrders[id] = choiceOrder(byId.get(id), config.shuffleChoices, randomInt);
    });
    return { questionIds, choiceOrders, answers: {}, checked: {}, currentIndex: 0 };
  }

  // Graded against the stored correct_choice of the rows the attempt used;
  // display letters play no part. Unanswered questions count as incorrect.
  function scoreAttempt(attempt, rowsById) {
    let correct = 0;
    attempt.questionIds.forEach((id) => {
      const row = rowsById.get(id);
      if (row && attempt.answers[id] === row.correct_choice) correct++;
    });
    const total = attempt.questionIds.length;
    return { correct, total, percent: total ? Math.round((correct / total) * 100) : 0 };
  }

  // Loads every row through fetchPage(from, to) -> { data, error }, one page
  // at a time, until a page comes back short. Any error, or a repeated id,
  // throws, so a partial bank is never used.
  async function loadAllPages(fetchPage, pageSize) {
    const size = pageSize || 1000;
    const rows = [];
    const seen = new Set();
    for (let from = 0; ; from += size) {
      const { data, error } = await fetchPage(from, from + size - 1);
      if (error) throw new Error(error.message || "Page could not be loaded.");
      const page = data || [];
      page.forEach((row) => {
        if (seen.has(row.id)) throw new Error("Duplicate row while paging.");
        seen.add(row.id);
        rows.push(row);
      });
      if (page.length < size) return rows;
    }
  }

  return {
    EXAMS,
    examConfigFor,
    requestedSlug,
    defaultRandomInt,
    attemptSize,
    selectQuestionIds,
    choiceOrder,
    displayLabel,
    displayLabelFor,
    spokenChoices,
    createAttempt,
    scoreAttempt,
    loadAllPages,
  };
});
