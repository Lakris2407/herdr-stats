// Raw rows from GitHub through `gh api graphql`: your PRs in every repo. Bodies and commit messages
// come only for the last 30 days, where AI share is measured.
import { exec, readTextFile, appHome } from "herdr";
import { weekStarts, aiTools } from "./stats.js";

// Optional ~/.config/herdr-app/stats.json:
//   { "logins": ["me", "me-work"], "workBranch": { "owner/repo": "develop" } }
// Without it: the account `gh` is logged in as, and each repo's default branch.
async function loadConfig() {
  const path = `${appHome()}/stats.json`, text = await readTextFile(path);
  let file = {};
  try { file = text ? JSON.parse(text) : {}; } catch { throw new Error(`${path} is not valid JSON`); }
  const logins = file.logins?.length ? file.logins : [(await graphql("query{viewer{login}}")).viewer.login];
  return { logins, workBranch: file.workBranch ?? {} };
}

const DAY = 86400000, AI_DAYS = 31;
const PR_FIELDS = "number state createdAt mergedAt closedAt headRefName baseRefName repository{nameWithOwner}";
const AI_FIELDS = "body commits(last:15){nodes{commit{message}}}";

async function graphql(query, vars = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) if (v != null) args.push("-f", `${k}=${v}`);
  let r = await exec("gh", args).catch((e) => ({ code: -1, stderr: String(e) }));
  // Apps started from the Dock can miss Homebrew on PATH: try its arm64 prefix.
  if (r.code === -1) r = await exec("/opt/homebrew/bin/gh", args).catch((e) => ({ code: -1, stderr: String(e) }));
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout || "").trim().split("\n")[0];
    throw new Error(/auth login|not logged/i.test(msg) ? "Run gh auth login first" : msg || `gh exit ${r.code}`);
  }
  const json = JSON.parse(r.stdout);
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

const day = (t) => new Date(t).toISOString().slice(0, 10);

// Search returns at most 1,000 rows per query, so ask one week at a time.
async function searchPrs(login, from, to, withAi) {
  const fields = withAi ? `${PR_FIELDS} ${AI_FIELDS}` : PR_FIELDS;
  const query = `query($q:String!,$c:String){search(query:$q,type:ISSUE,first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{... on PullRequest{${fields}}}}}`;
  const q = `is:pr author:${login} created:${day(from)}..${day(to)}`;
  const rows = [];
  let c = null;
  for (let page = 0; page < 10; page++) {
    const s = (await graphql(query, { q, c })).search;
    for (const n of s.nodes) {
      if (n.number == null) continue;
      const { body, commits, repository, ...pr } = n;
      // Classify now and drop the text: the cache keeps only what the panel shows.
      rows.push({ ...pr, repo: repository.nameWithOwner,
        ai: withAi ? aiTools({ body, headRefName: pr.headRefName, messages: commits.nodes.map((x) => x.commit.message) }) : null });
    }
    if (!s.pageInfo.hasNextPage) break;
    c = s.pageInfo.endCursor;
  }
  return rows;
}

async function fetchPrs(config, now, days) {
  const windows = [];
  for (let to = now; to > now - days * DAY; to -= 7 * DAY) windows.push([Math.max(now - days * DAY, to - 7 * DAY), to]);
  const jobs = config.logins.flatMap((login) => windows.map(([from, to]) =>
    searchPrs(login, from, to + DAY, to > now - AI_DAYS * DAY)));
  return (await Promise.all(jobs)).flat();
}

// Commits linked to your accounts in each repo you merged into, on its working branch, last 30 days.
async function fetchCommits(config, now, repos) {
  const ids = await graphql(`query{${config.logins.map((l, i) => `u${i}: user(login:${JSON.stringify(l)}){id}`).join(" ")}}`);
  const authors = config.logins.map((_, i) => ids[`u${i}`]?.id).filter(Boolean);
  if (!repos.length || !authors.length) return {};
  const since = new Date(now - 30 * DAY).toISOString();
  const parts = repos.map((full, r) => {
    const [owner, name] = full.split("/"), branch = config.workBranch[full];
    const ref = branch ? `ref(qualifiedName:${JSON.stringify(`refs/heads/${branch}`)})` : "defaultBranchRef";
    const counts = authors.map((id, a) => `a${a}: history(since:"${since}", author:{id:${JSON.stringify(id)}}){totalCount}`).join(" ");
    return `r${r}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){${ref}{target{... on Commit{${counts}}}}}`;
  });
  const data = await graphql(`query{${parts.join(" ")}}`);
  return Object.fromEntries(repos.map((full, r) => {
    const target = data[`r${r}`]?.ref?.target ?? data[`r${r}`]?.defaultBranchRef?.target;
    return [full, authors.reduce((s, _, a) => s + (target?.[`a${a}`]?.totalCount ?? 0), 0)];
  }));
}

// Reviews = other people's PRs you commented on (Codex/Claude reviews post through your account),
// bucketed by when the PR was opened. Open PRs have no date limit.
async function fetchCountsAndOpen(config, now) {
  const notMine = config.logins.map((l) => `-author:${l}`).join(" ");
  const parts = config.logins.flatMap((login, i) => [
    `r${i}_last: search(query:${JSON.stringify(`is:pr commenter:${login} ${notMine} created:>=${day(now - 30 * DAY)}`)}, type:ISSUE){ issueCount }`,
    `r${i}_prev: search(query:${JSON.stringify(`is:pr commenter:${login} ${notMine} created:${day(now - 60 * DAY)}..${day(now - 30 * DAY)}`)}, type:ISSUE){ issueCount }`,
    `o${i}: search(query:${JSON.stringify(`is:pr is:open author:${login}`)}, type:ISSUE, first:100){ nodes{ ... on PullRequest{ number createdAt headRefName baseRefName repository{nameWithOwner} } } }`,
  ]);
  const data = await graphql(`query{${parts.join(" ")}}`);
  const reviews = { last30: 0, prev30: 0 }, open = [];
  config.logins.forEach((_, i) => {
    reviews.last30 += data[`r${i}_last`].issueCount;
    reviews.prev30 += data[`r${i}_prev`].issueCount;
    open.push(...data[`o${i}`].nodes.map(({ repository, ...pr }) => ({ ...pr, repo: repository.nameWithOwner })));
  });
  return { reviews, open };
}

// 13 weeks of PRs: 12 for the chart plus room for the 90-day merge rate.
export async function loadRaw(now = Date.now(), weeks = 12) {
  const config = await loadConfig();
  const [prs, counts] = await Promise.all([fetchPrs(config, now, 91), fetchCountsAndOpen(config, now)]);
  const recent = [...new Set(prs.filter((pr) => pr.mergedAt && Date.parse(pr.mergedAt) > now - 30 * DAY).map((pr) => pr.repo))];
  const commits = await fetchCommits(config, now, recent);
  return { prs, commits, ...counts, now, weeks, starts: weekStarts(now, weeks) };
}
