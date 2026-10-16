# Competitor reference

## MyRacePass (MRP) — myracepass.com

The incumbent platform at US dirt tracks: track websites, points, race management,
online tickets, fan app with live timing.

### Promoter race-management pricing
Source: myracepass.com/experience/promoters/race-management/pricing (photographed 2026-07-08).
All pricing USD, per year, no setup fee.

| Tier | Price | What it is |
|---|---|---|
| Essential | **$349/yr** | Track bio/listing on the MRP network only — no race management |
| Plus | **$599/yr** | Basic Race Management + 2 All Access fan accounts |
| Platinum | **$799/yr** | Advanced Race Management + 4 All Access fan accounts |
| Partner | **$999/yr** | Premium Race Management + 6 All Access fan accounts |

### Fan-side subscription pricing
Source: myracepass.com/experience/pricing (searched 2026-07-08). Fans/drivers pay MRP
directly for access to lineups, points, and live timing in the MRP app:

- MRP Basic — $7.99/yr (event listings, entry lists, lineups, results, basic points)
- MRP Pro — $34.99/yr (adds MRP Live timing, advanced profiles, sanction points)
- MRP All Access — $5.99/mo or $54.99/yr (everything + fantasy, announcer audio)

### Positioning takeaways for RaceDay

1. **Real MRP race management starts at $599/yr.** Their $349 tier is only a network
   listing — it runs nothing on race night.
2. **MRP charges both sides.** Tracks pay yearly AND fans pay $8–55/yr to see lineups
   and points in the app. RaceDay's spectator QR view is free for fans — no app, no
   account, no subscription. Lead with this in outreach.
3. **Different shape.** MRP is a platform (website, tickets, fan network); RaceDay is
   the race-night operations tool (sign-up, lineups, results, points, TV). "Keep your
   MRP website, run your race night on RaceDay" is a viable pitch at locked-in tracks —
   don't fight the whole platform head-on.

---

## Market scan — 2026-10-16

Research for the "what are we missing?" review. Vendor sites were blocked from the research
environment, so these come from search summaries of those pages. Confirm prices on the live sites.

### MyRacePass — newer features worth knowing
- **Payout ledger:** per class per night, with payment type (check, cash, direct deposit), pay the
  car owner instead of the driver, and a yearly Excel export for 1099 prep. Stores no SSN/TIN.
  ([support](https://support.myracepass.com/hc/en-us/articles/115002361231))
- **Lineups:** invert, redraw, passing-points lineups (ties broken by season points, then pill
  draw), simple-transfer lineups.
  ([invert/redraw](https://support.myracepass.com/hc/en-us/articles/115002663328),
  [transfers](https://support.myracepass.com/hc/en-us/articles/360041844611-Simple-Transfer-Line-ups))
- **MRP Digital Waivers (2026):**
  - Pit passes plus e-waivers, sold online.
  - Only for tracks insured by K&K or SIS. Minors are **not** covered.
  - The buyer pays $1.90 + 4%.
  - ([press release](https://performanceracing.com/tradeshow/exhibitor/press-releases/product/2025-12-01/myracepass-launches-mrp-digital-waivers-2026))
- **Other:** ticketing with gate scanning, push notifications (no SMS), MRP Audio (announcer streamed
  into the app), fantasy pick'em, and USAC national racing on MRP from 2026.

### Others
| Product | What it is | Notable |
|---|---|---|
| **Scoring.Racing** | "Simple, affordable alternative to MyRacePass" — $250 / $550 per year | Registration and check-in, points and pay calculation, free browser lineups, **text-message lineups** ([site](https://scoring.racing/)) |
| **Pit Pay / Kart Pass** | Mobile pit passes and e-waivers | **Minor releases** sent to both parents, ID scan, memberships, push alerts ([Speedsport](https://www.speedsport.com/more/pit-pay-a-mobile-pit-pass-app/)) |
| **MYLAPS Orbits + Speedhive** | Transponder timing | Announcer page, full-screen TV mode, auto text commentary; needs decoder hardware ([Speedhive](https://www.mylaps.com/?p=3193)) |
| **Race Monitor** | Live timing viewer | Paid alerts when a followed driver goes on track |
| **LiveTime** | Karting and RC scoring | Ladder mains, self-registration kiosks, backup scoring PC |
| **Race Hero** | — | **Shut down 12/31/2024**, recommended Speedhive ([KartPulse](https://forums.kartpulse.com/t/race-hero-shut-down-as-of-12-31-2024-recommends-speedhive/13369)) |

### What RaceDay did about it
- **Built (RaceDay v2):**
  - Passing-points heats and a points table per class
  - Payout ledger, with owner payee, season CSV, and no tax IDs
  - Tech inspection, with a tech-tablet role — nobody else had a real workflow
  - Announcer screen, with an announcer role
- **Later:**
  - Online pre-registration with payment (Stripe via the existing Cloud Functions)
  - A rainout/announcement banner on the free spectator page
- **Skipped:**
  - E-waivers and minor releases — insurer-approved forms and liability; partner instead
  - SMS — per-message cost and carrier rules
  - Ticketing, fantasy, announcer audio, memberships
  - Live transponder feeds — need decoder hardware, not a browser

**Still unique to RaceDay:**
- A free spectator view by QR code, with no app.
- Pill-draw sign-up as its own flow.
- Tap or number-pad scoring.
- Fully offline.
- Free cross-track driver profiles (Driven).
