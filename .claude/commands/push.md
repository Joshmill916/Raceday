Commit all changed app files on the current branch and push to origin.

$ARGUMENTS is the commit message. If not provided, ask for one before proceeding.

Steps:
1. `git status` — show what's changed
2. Stage app files only: `git add index.html sw.js manifest.webmanifest CLAUDE.md BACKLOG.md .gitignore .claude/settings.json .claude/commands/`
   — NEVER stage `raceday-codegen.html` under any circumstances
3. `git commit -m "$ARGUMENTS"`
4. `git push -u origin $(git branch --show-current)`
5. Confirm with the commit hash and branch name.
