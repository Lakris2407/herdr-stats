import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStart, weekStarts, isPromotion, median, buildStats, duration, delta, aiTools } from "../mods/stats/stats.js";

const at = (s) => new Date(s).getTime();
const iso = (s) => new Date(s).toISOString();

test("weekStart is local Monday midnight", () => {
  const d = new Date(weekStart(at("2026-11-01T15:00:00")));
  assert.equal(d.getDay(), 1);
  assert.equal(d.getDate(), 26);
  assert.equal(d.getHours(), 0);
  assert.equal(new Date(weekStart(at("2026-10-26T00:00:00"))).getDate(), 26);
});

test("weekStarts ends with this week, oldest first", () => {
  const starts = weekStarts(at("2026-11-01T12:00:00"), 3);
  assert.deepEqual(starts.map((t) => new Date(t).getDate()), [12, 19, 26]);
});

test("a develop -> main release is a promotion; a hotfix to main is not", () => {
  assert.equal(isPromotion({ headRefName: "develop", baseRefName: "main" }), true);
  assert.equal(isPromotion({ headRefName: "fix/x", baseRefName: "main" }), false);
});

test("median handles odd, even and empty", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 10]), 2.5);
  assert.equal(median([]), null);
});

test("buildStats counts merges by week and day, skips releases and duplicates", () => {
  const now = at("2026-11-01T12:00:00");
  const pr = (number, created, merged, extra = {}) => ({ repo: "o/a", number, createdAt: iso(created), mergedAt: merged && iso(merged), closedAt: merged && iso(merged), headRefName: "feat", baseRefName: "develop", ...extra });
  const prs = [
    pr(1, "2026-10-27T09:00:00", "2026-10-27T10:00:00"),
    pr(1, "2026-10-27T09:00:00", "2026-10-27T10:00:00"), // same PR from a second search window
    pr(2, "2026-11-01T08:00:00", "2026-11-01T11:00:00"),
    pr(3, "2026-10-20T08:00:00", "2026-10-21T08:00:00"),
    pr(4, "2026-10-31T08:00:00", "2026-10-31T09:00:00", { headRefName: "develop", baseRefName: "main" }),
    { ...pr(5, "2026-10-29T08:00:00", null), closedAt: iso("2026-10-29T09:00:00") },
  ];
  const s = buildStats({ prs, commits: {}, reviews: { last30: 4, prev30: 2 }, open: [{ createdAt: iso("2026-10-29T12:00:00"), headRefName: "x", baseRefName: "develop" }], now, weeks: 2 });
  assert.equal(s.mergedThisWeek, 2);
  assert.equal(s.mergedLastWeek, 1);
  assert.equal(s.merged30, 3);
  assert.deepEqual(s.days.map((d) => d.merged), [0, 1, 0, 0, 0, 0, 1]);
  assert.equal(s.medianHours, 3);
  assert.equal(s.mergeRate, 75);
  assert.equal(s.open, 1);
  assert.equal(s.oldestOpenDays, 3);
});

test("PRs with the same number in two repos both count; repos rank by merges", () => {
  const now = at("2026-11-01T12:00:00");
  const pr = (repo, number) => ({ repo, number, createdAt: iso("2026-10-30T08:00:00"), mergedAt: iso("2026-10-30T09:00:00"), headRefName: "f", baseRefName: "main" });
  const s = buildStats({ prs: [pr("o/a", 1), pr("o/b", 1), pr("o/b", 2)], commits: { "o/a": 7, "o/b": 3 }, now, weeks: 1 });
  assert.equal(s.merged30, 3);
  assert.deepEqual(s.repos, [{ repo: "o/b", merged: 2, commits: 3 }, { repo: "o/a", merged: 1, commits: 7 }]);
  assert.equal(s.commits30, 10);
});

test("aiTools reads trailers, sign-off lines and branch names, not review mentions", () => {
  assert.deepEqual(aiTools({ messages: ["fix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"] }), { claude: true, codex: false });
  assert.deepEqual(aiTools({ headRefName: "codex/bugs" }), { claude: false, codex: true });
  assert.deepEqual(aiTools({ messages: ["x\n\nCo-Authored-By: Codex <noreply@openai.com>\nCo-Authored-By: Claude <noreply@anthropic.com>"] }), { claude: true, codex: true });
  assert.deepEqual(aiTools({ body: "🤖 Generated with Codex (spec and review by Claude Code)" }), { claude: false, codex: true });
  assert.deepEqual(aiTools({ body: "Codex review (gpt-6.1-sol, high): no findings" }), { claude: false, codex: false });
});

test("a PR from two search windows keeps the copy with AI marks", () => {
  const now = at("2026-11-01T12:00:00");
  const pr = (ai) => ({ repo: "o/a", number: 1, createdAt: iso("2026-10-30T08:00:00"), mergedAt: iso("2026-10-30T09:00:00"), headRefName: "f", baseRefName: "main", ai });
  const s = buildStats({ prs: [pr({ claude: true, codex: false }), pr(null)], now, weeks: 1 });
  assert.deepEqual(s.ai, { claude: 1, codex: 0, both: 0, none: 0, total: 1 });
});

test("AI share splits merged PRs into Claude, Codex, both and none", () => {
  const now = at("2026-11-01T12:00:00");
  const pr = (number, ai) => ({ repo: "o/a", number, createdAt: iso("2026-10-30T08:00:00"), mergedAt: iso("2026-10-30T09:00:00"), headRefName: "f", baseRefName: "main", ai });
  const s = buildStats({ prs: [pr(1, { claude: true, codex: false }), pr(2, { claude: true, codex: true }), pr(3, { claude: false, codex: false }), pr(4, null)], now, weeks: 1 });
  assert.deepEqual(s.ai, { claude: 1, codex: 0, both: 1, none: 1, total: 3 });
});

test("duration and delta format for tiles", () => {
  assert.equal(duration(0.25), "15m");
  assert.equal(duration(1.16), "1.2h");
  assert.equal(duration(72), "3d");
  assert.equal(duration(null), "—");
  assert.deepEqual(delta(5, 3), { d: 2, text: "+2 vs" });
  assert.deepEqual(delta(3, 5), { d: -2, text: "−2 vs" });
  assert.equal(delta(3, 3).text, "same as");
});
