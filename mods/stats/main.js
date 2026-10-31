// Your own delivery numbers across every repo in a side panel: PRs merged, time to merge, AI share, reviews and commits.
// Data comes from `gh` (load.js) and is kept in shared state for 30 minutes, so opening the panel is instant.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, shared, setShared, nextCommand } from "herdr";
import { loadRaw } from "./load.js";
import { buildStats, duration, delta } from "./stats.js";

const CACHE = "stats.v1", STALE = 30 * 60000, CHECK = 5 * 60000;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Checked for dark-theme lightness and color-blind separation in this order (Claude, Codex, Both).
const AI = [["claude", "Claude", "#d4704f"], ["codex", "Codex", "#3f86e0"], ["both", "Both", "#1baf7a"]];
const TOP_REPOS = 5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const short = (t) => { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const fmt = (n) => (n == null ? "—" : n.toLocaleString("en"));

function ago(at) {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return "just now";
  return min < 60 ? `${min}m ago` : `${Math.round(min / 60)}h ago`;
}

export default class Stats extends View {
  init(_props, cx) {
    this.cache = shared(CACHE) ?? null;
    if (!this.cache || Date.now() - this.cache.at > STALE) this.load(cx);
    cx.timer.every(CHECK, (cx) => { if (!this.cache || Date.now() - this.cache.at > STALE) this.load(cx); });
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "refresh") this.load(cx);
        cx.notify();
      }
    });
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true; this.error = null;
    cx.spawn(async (cx) => {
      try {
        const raw = await loadRaw();
        this.cache = { at: Date.now(), stats: buildStats(raw) };
        setShared(CACHE, this.cache);
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
    cx.notify();
  }

  tile(label, value, hint, t, change = null) {
    return v_flex().flex_1().min_w(0).gap(1).px(10).py(9).rounded(8).bg(t.raised)
      .child(div().text_size(11).text_color(t.muted).child(label))
      .child(div().text_size(22).font_semibold().child(value))
      .child(h_flex().gap(4).text_size(11).text_color(t.dim)
        .when(Boolean(change), (e) => e.child(div().text_color(change.d > 0 ? t.ansi2 : change.d < 0 ? t.ansi1 : t.dim)
          .child(`${change.d > 0 ? "▲" : change.d < 0 ? "▼" : "•"} ${change.text}`)))
        .child(div().min_w(0).truncate().child(hint)));
  }

  // One series, so no legend: the card title names it. Values sit on the highlighted bar and the tallest one;
  // every bar has its value on hover.
  bars(id, items, { height, label, tip, highlight, faded }, t) {
    const max = Math.max(1, ...items.map((i) => i.value)), top = items.reduce((b, i, n) => (i.value > items[b].value ? n : b), 0);
    const plot = height - 16;
    return v_flex().gap(4)
      .child(h_flex().h(height).items_end().gap(3).children(items.map((item, n) => {
        const show = n === highlight || (n === top && item.value > 0);
        return v_flex().id(`${id}-${n}`).flex_1().h_full().justify_end().items_center().gap(2).tooltip(tip(item))
          .child(div().h(12).text_size(10).text_color(n === highlight ? t.foreground : t.muted).child(show ? fmt(item.value) : ""))
          .child(div().w_full().h(Math.max(item.value > 0 ? 3 : 1, Math.round(plot * item.value / max))).rounded_t(item.value > 0 ? 4 : 0)
            .bg(item.value > 0 ? t.accent : t.border).opacity(n === highlight || !faded ? 1 : 0.55));
      })))
      .child(h_flex().gap(3).children(items.map((item, n) => div().flex_1().text_size(10).text_center()
        .text_color(n === highlight ? t.foreground : t.dim).when(n === highlight, (e) => e.font_semibold()).child(label(item, n)))));
  }

  card(title, sub, body, t) {
    return v_flex().gap(6).px(10).pt(10).pb(8).rounded(8).bg(t.raised)
      .child(v_flex().child(div().text_size(12.5).font_semibold().child(title)).child(div().text_size(11).text_color(t.dim).child(sub)))
      .child(body);
  }

  // One magnitude per repo: a single hue, longest first, the number beside each bar.
  repoList(repos, t) {
    const max = Math.max(1, ...repos.map((r) => r.merged)), top = repos.slice(0, TOP_REPOS), rest = repos.slice(TOP_REPOS);
    const restPrs = rest.reduce((n, r) => n + r.merged, 0);
    return v_flex().gap(6)
      .children(top.map((r) => v_flex().id(`repo-${r.repo}`).gap(3).tooltip(`${r.repo}: ${r.merged} PRs merged, ${fmt(r.commits)} commits`)
        .child(h_flex().gap(8).text_size(11.5)
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(r.repo.split("/")[1]))
          .child(div().font_semibold().child(fmt(r.merged))))
        .child(div().h(6).w_full().rounded(3).bg(t.border)
          .child(div().h(6).rounded(3).bg(t.accent).w(`${Math.max(2, Math.round(100 * r.merged / max))}%`)))))
      .when(rest.length > 0, (e) => e.child(div().text_size(11).text_color(t.dim)
        .child(`${rest.length} more ${rest.length === 1 ? "repo" : "repos"} · ${fmt(restPrs)} PRs`)));
  }

  // A share of a whole: one split bar with 2px gaps, then a legend with counts, so color is never the only label.
  aiSplit(ai, t) {
    const made = ai.claude + ai.codex + ai.both, pct = ai.total ? Math.floor(100 * made / ai.total) : null; // floor: 845 of 848 is not 100%
    const parts = [...AI.map(([key, label, color]) => ({ key, label, color, n: ai[key] })), { key: "none", label: "No AI mark", color: t.border, n: ai.none }]
      .filter((p) => p.n > 0);
    return v_flex().gap(8)
      .child(h_flex().gap(8).items_end()
        .child(div().text_size(24).font_semibold().child(pct == null ? "—" : `${pct}%`))
        .child(div().pb(4).text_size(11).text_color(t.dim).child(`of ${fmt(ai.total)} merged PRs made with AI`)))
      .child(h_flex().h(8).gap(2).children(parts.map((p) => div().id(`ai-${p.key}`).h_full().rounded(2).bg(p.color)
        .flex_grow(p.n).flex_basis(0).min_w(3).tooltip(`${p.label}: ${p.n} PRs`))))
      .child(h_flex().flex_wrap().gap(12).text_size(11).text_color(t.muted).children(parts.map((p) =>
        h_flex().gap(5).items_center().child(div().size(8).rounded(2).bg(p.color)).child(`${p.label} ${fmt(p.n)}`))));
  }

  row(label, value, hint, t) {
    return h_flex().gap(8).py(6).items_center().border_t(1).border_color(t.border)
      .child(div().flex_1().min_w(0).text_color(t.muted).child(label))
      .child(div().text_size(11).text_color(t.dim).child(hint))
      .child(div().w(64).text_right().font_semibold().child(value));
  }

  body(s, t) {
    const weeks = s.weeks, last = weeks.length - 1, today = (new Date().getDay() + 6) % 7;
    return v_flex().gap(8)
      .child(h_flex().gap(6)
        .child(this.tile("Merged this week", fmt(s.mergedThisWeek), "last week", t, delta(s.mergedThisWeek, s.mergedLastWeek)))
        .child(this.tile("Merged · 30 days", fmt(s.merged30), "prior 30", t, delta(s.merged30, s.mergedPrev30))))
      .child(h_flex().gap(6)
        .child(this.tile("Time to merge", duration(s.medianHours), "median · 30 days", t))
        .child(this.tile("Open PRs", fmt(s.open), s.oldestOpenDays == null ? "none open" : `oldest ${s.oldestOpenDays}d`, t)))
      .child(this.card("PRs merged per week", "all your repos · releases to main not counted",
        this.bars("wk", weeks.map((w) => ({ ...w, value: w.merged })), {
          height: 110, highlight: last, faded: true,
          label: (w, n) => (n === last ? "now" : n % 3 === 0 ? short(w.start) : ""),
          tip: (w) => `Week of ${short(w.start)}: ${w.merged} PRs merged`,
        }, t), t))
      .child(this.card("This week, day by day", "PRs merged · your local time",
        this.bars("day", s.days.map((d) => ({ ...d, value: d.merged })), {
          height: 70, highlight: today, faded: false,
          label: (_d, n) => DAYS[n],
          tip: (d) => `${DAYS[(new Date(d.start).getDay() + 6) % 7]} ${short(d.start)}: ${d.future ? "not yet" : `${d.merged} merged`}`,
        }, t), t))
      .child(this.card("AI share", "merged PRs · last 30 days", this.aiSplit(s.ai, t), t))
      .child(this.card("By repo", "PRs merged · last 30 days", this.repoList(s.repos, t), t))
      .child(this.card("Last 30 days", "all your repos", v_flex()
        .child(this.row("Your commits", fmt(s.commits30), `${s.repos.filter((r) => r.commits > 0).length} repos`, t))
        .child(this.row("Reviews of others' PRs", fmt(s.reviews.last30), `prior 30: ${fmt(s.reviews.prev30)}`, t))
        .child(this.row("Merge rate", s.mergeRate == null ? "—" : `${s.mergeRate}%`, `${fmt(s.decided)} decided · 90 days`, t)), t));
  }

  render(cx) {
    const t = theme(), s = this.cache?.stats;
    const status = this.loading ? "Loading…" : this.cache ? `updated ${ago(this.cache.at)}` : "";
    return v_flex().id("stats").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Your stats"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(status))
        .child(div().id("stats-refresh").px(8).h(26).flex().items_center().rounded(7).cursor_pointer().text_size(11).text_color(t.muted)
          .hover((e) => e.bg(t.hover)).on_click((_e, cx) => this.load(cx)).child(this.loading ? "…" : "Refresh")))
      .child(v_flex().id("stats-body").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(8)
        .when(Boolean(this.error), (e) => e.child(div().text_size(11).text_color(t.ansi1).child(this.error)))
        .when(!s && !this.error, (e) => e.child(div().p(4).text_color(t.dim).child("Loading your numbers… the first load takes about 15 seconds.")))
        .when(Boolean(s), (e) => e.child(this.body(s, t))));
  }
}
