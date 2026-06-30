Show the current branch state: what branch we're on, what's uncommitted, and how far ahead of main.

Run in order:
1. `git branch --show-current`
2. `git status --short`
3. `git log --oneline -5`
4. `git log --oneline origin/main..HEAD`

Summarize: current branch, any uncommitted files, and how many commits ahead of main (with their messages).
