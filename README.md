# Your stats in Herdr

A side panel for the [Herdr](https://herdr.dev) desktop app with your own delivery numbers across
every repo you open PRs in: PRs merged per week and per day, median time to merge, open PRs, how
much of your work was made with Claude or Codex, PRs and commits per repo, reviews of other people's
PRs, and merge rate.

![Your stats panel (demo data)](preview.png)

The screenshot uses made-up data.

## How it counts

- **PRs** are yours when you opened them, in any repo. Releases (`develop` → `main`) are left out,
  because their work was already counted when it merged into `develop`. Hotfixes into `main` count.
- **AI share** looks at the PRs merged in the last 30 days:
  - Claude: a `Co-Authored-By: Claude` commit trailer, "Generated with Claude Code" in the PR text,
    or a `claude/` branch.
  - Codex: a `Co-Authored-By: Codex` trailer, "Generated with Codex" in the PR text, or a `codex/`
    branch. A plain mention of Codex in the PR text does not count, because it usually describes a
    Codex review.
  - A PR with marks from both counts as Both. The percentage rounds down.
- **Commits** are commits linked to your account in each repo you merged into during the last 30
  days, on the repo's default branch (or the branch you set in `workBranch`, below).
- **Reviews** are other people's PRs you commented on (Codex and Claude reviews that post through
  your account count too), bucketed by when the PR was opened.
- **Merge rate** is merged ÷ (merged + closed without merging) over the last 90 days.
- Weeks start on Monday in your local time.

## Settings

With no settings, the panel counts the account `gh` is logged in as. To count more accounts, or to
count commits on a branch other than the default, create `~/.config/herdr-app/stats.json`:

```json
{
  "logins": ["your-login", "your-work-login"],
  "workBranch": { "your-org/your-repo": "develop" }
}
```

## Data and speed

Everything comes from `gh api graphql`, so [`gh`](https://cli.github.com) must be logged in
(`gh auth login`). A full load takes about 15 seconds: 13 weekly searches per account (search
returns at most 1,000 rows), PR texts only for the last 30 days, and one query for commit counts.
Only the computed numbers are kept, in Herdr's shared state (`stats.v1`), for 30 minutes, so the
panel opens at once. **Refresh** reloads now, and `herdr-app do stats.refresh` does the same from a
terminal. The mod sends nothing anywhere except your own `gh` queries to GitHub.

## Install

Or ask the agent running in Herdr: "add the herdr.dev mod Lakris2407/herdr-stats".

1. Copy `mods/stats` to `~/.config/herdr-app/mods/stats` and run
   `herdr-app check ~/.config/herdr-app/mods/stats`.
2. Herdr's own layouts and mods are read-only, so clone the layout and the tab bar:

   ```sh
   herdr-app do layout.clone '{"name":"main","as":"main-plus"}'
   herdr-app do mod.clone '{"name":"tabs","as":"tabs-plus"}'
   ```

3. In `~/.config/herdr-app/layouts/main-plus.json`, use `tabs-plus` for the `tabs` block, and add the
   panel to the side panel stack (`panel-body`), next to Files and Changes:

   ```json
   { "id": "stats", "type": "block", "content": { "mod": "stats" } }
   ```

4. In `~/.config/herdr-app/mods/tabs-plus/main.js`, add `"stats"` to the enabled panels and a button
   beside the others:

   ```js
   .child(panelButton("stats", "Stats", "mods/stats/stats.svg"))
   ```

## Tests

```sh
node --test
```

`mods/stats/stats.js` holds all the counting and has no Herdr imports, so the tests run in plain Node.

## License

MIT
