# Bannerfall

A slow fantasy castle-and-army idle game for a few friends. Check in once a day: queue upgrades, train troops, set standing orders, and watch your borders. Sieges telegraph hours ahead, so there is always something to react to if you want to play actively.

- Plain HTML + JS modules. No build step, no framework.
- Runs as a static site, so GitHub Pages works.
- **Local mode** runs entirely in your browser against bots, with a speed dial for testing.
- **Online mode** stores the shared world in a free Supabase project.

The full design (units, trees, formulas, balance results) is in [docs/DESIGN.md](docs/DESIGN.md).

## Run it locally

Browsers block ES modules from `file://`, so serve the folder:

```bash
python3 -m http.server 8080      # or: npx serve .
# open http://localhost:8080
```

Pick bots, set speed to 360x or 1440x, and play. The **Dev** tab can:

- Skip time.
- Switch which kingdom you control (hot-seat).
- Add resources.
- Export or import saves.

## Tests and balance tools

These need Node 20 or newer.

```bash
npm test                     # engine tests: determinism, economy, counters, sieges, sally, spells
node tools/sim.js 4 35 seed  # full 35-day bot season, prints snapshots every 5 days
node tools/matrix.js 6000    # equal-value 1v1 unit matchup grid
node tools/tables.js         # markdown tables of all unit/building/tech data
```

Every tunable number is in `js/data.js`.

## Project layout

```
index.html, css/style.css     page shell and styles
js/data.js                    all game data and tuning constants
js/engine.js                  deterministic simulation + player actions
js/battle.js                  phased battle resolution
js/map.js                     hex map generation, pathfinding, vision
js/ai.js                      bots (local mode + balance sim)
js/ui.js, js/main.js          interface and setup screens
js/store-local.js             localStorage save
js/store-supabase.js          online save (Supabase)
js/config.js                  your Supabase URL + anon key
supabase/schema.sql           tables + row-level security
tests/, tools/                tests and balance scripts
```

## Put it on GitHub Pages

1. Create the repo and push. With the GitHub CLI:

   ```bash
   cd bannerfall
   gh repo create bannerfall --public --source=. --push
   ```

   Or create an empty repo named `bannerfall` on github.com, then:

   ```bash
   git remote add origin https://github.com/<you>/bannerfall.git
   git push -u origin main
   ```

2. On GitHub, go to **Settings → Pages**. Set **Source** to "Deploy from a branch", choose **Branch** `main` and folder `/ (root)`, then save.
3. After a minute the game is live at `https://<you>.github.io/bannerfall/`. Local mode works there immediately.

## Online play with friends (Supabase, free tier)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste in `supabase/schema.sql`, and run it.
3. Go to **Authentication → URL Configuration**:
   - Set **Site URL** to your Pages URL.
   - Add `https://<you>.github.io/bannerfall/` and `http://localhost:8080/` to **Redirect URLs**.
4. Go to **Project Settings → API**. Copy the Project URL and the `anon` public key into `js/config.js`. Commit and push.
5. Everyone opens the site and clicks **Sign in**, which sends an email magic link.
6. One person clicks **Create world** and shares the world code. Friends enter the code under **Join**.
7. Once everyone has joined, the host presses **Start season**.

How online saves work:

- Each action loads the world, catches it up to the current time, applies your move, and saves only if nobody else saved in between. Otherwise it retries.
- Clients also re-pull every minute to show other players' moves.

Online caveats:

- The online adapter is written but **has not been run against a live Supabase project**. Expect to debug the first sign-in, create, join, and start flow.
- Any member can technically write any world state. That's fine among friends, but not cheat-proof.
- Players have to join before the host starts the season.
