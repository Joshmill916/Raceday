---
name: growth
description: Weekly marketing pass for victoryraceday.com, like an AI marketing co-founder. Audits the marketing site (speed, share previews, SEO tags), writes next week's posts and promoter messages, and adds tracks to the outreach list, then updates the RaceDay Growth Playbook page. Use when asked to run /growth, do the weekly marketing, write this week's posts, or refresh the outreach list.
---

# /growth — weekly marketing pass

Three jobs, in this order. `$ARGUMENTS` can narrow it ("posts only", "audit only", "tracks: Ohio karting").

The output lives in the **RaceDay Growth Playbook** artifact:
https://claude.ai/artifact/7tsx89kKJhKCVycNABPkZq
Read it first (`Artifact` action `read`). Build on the version that comes back, then publish
the result back to that same `url`. Never publish a new artifact for this. If the read fails,
start from `.claude/skills/growth/playbook.html` (the copy from 2026-10-30) and say so.

## 1. Site audit (fix on a branch, never on main)

Check every marketing page: root `index.html`, `pricing.html`, `faq.html`, `field-manual.html`,
`guides/*.html`, `drivers/**/*.html`, and the short links `fb/ li/ qr/` plus their `drivers/` versions.

- **Weight**: no `data:image` base64 images in marketing pages. Root `index.html` should stay
  well under 100 KB. Move any new screenshot into `img/` or `guides/img/` as a compressed JPEG,
  with width/height set and `loading="lazy"` below the fold.
- **Previews**: `og:image` + `og:image:width/height` + `twitter:card=summary_large_image` +
  `twitter:image`. RaceDay pages use `img/share-raceday.png`, Driven pages `img/share-driven.png`.
  Short-link pages keep `og:url` = the short link itself so clicks stay counted.
- **SEO**: `<link rel="canonical">` on every indexable page (short links are `noindex`).
  `index.html` has SoftwareApplication JSON-LD whose prices must match `pricing.html`.
  `faq.html` has FAQPage JSON-LD whose Q&As must match the visible FAQ. Regenerate it if
  questions changed. Every indexable page should be in `sitemap.xml`.
- **Stale promos**: banners or copy for a sale that has ended.
- Leave the app (`raceday/`, `driven/`) alone. This skill only handles marketing pages.

If anything needs fixing, branch `claude/growth-YYYY-MM-DD` from main, fix it, run the syntax
check on each edited page, then run `node tests/test-analytics.js | tail -1` (it covers the
short links and beacon loader). Commit, push, and open a PR. **Do not merge.** Merging to main
needs the user's explicit OK (CLAUDE.md). In a scheduled run, leave the PR open and list it in
the summary.

## 2. Next week's posts + messages

Write 7 posts (Mon–Sun of the coming week) and refresh the promoter message templates in the playbook.

- **Season**: Nov–Feb is the offseason pitch. Promoters plan next season, and a season pass
  bought from October on covers next season. Mar–Apr is opening night and the free trial. May–Sep
  is in-season: feature clips, Driven for drivers, fan QR. Late Sep–Oct is end of season:
  points wrap-up and sales.
- **What's new**: run `git log --since="8 days ago" --oneline origin/main` and skim the new
  commits. A shipped feature makes a good post.
- **Facts only**: prices, numbers and claims must come from `pricing.html`, `index.html` or
  `drivers/` as they stand today. Never invent stats, testimonials or track names as customers.
  Name a competitor only with facts from `COMPETITORS.md`, and prefer the contrast
  without naming them.
- **Links**: Facebook posts use `victoryraceday.com/fb/` (drivers: `/fb/drivers/`), LinkedIn
  uses `/li/`. Only those two paths exist under each, so don't link `/fb/pricing.html`.
- Mix in at least one Driven post, one short-video shot list, and one kart/quarter midget club post.
- Don't repeat last week's posts. The playbook shows them, so change the angle.
- Plain voice, short sentences, a few ✅ bullets at most. Promoter messages sign off as "[your name]".

Move last week's posts into the playbook's "Past weeks" section (add one if missing; keep 4 weeks).

## 3. Outreach list

Add 10–15 new tracks or clubs to the playbook's table. Kart and quarter midget clubs come first,
then small weekly dirt and micro tracks, then larger asphalt tracks. Rotate regions so the
list stays nationwide unless `$ARGUMENTS` names one.

- Use WebSearch. Every row needs a source URL from the results that names that track.
- Don't add contact details unless a source shows them. Don't duplicate existing rows (match by name).
- Never remove rows. The "Sent" checkboxes are keyed by track name, so keep names unchanged.
- Update the row count in the "Tracks to contact" intro and the compiled date in the footer.

## Finish

Publish the playbook to its `url`. Then give a short summary: the audit result (any PR link),
this week's post themes, and how many tracks were added. List every source URL used.
