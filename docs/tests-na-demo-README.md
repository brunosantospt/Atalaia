# Tests na demo — handoff README

Snapshot of the "Tests na demo" fix effort on Atalaia, status refreshed 2026-10-22 03:32 (usage-limit checkpoint; the 5-hour limit was at 87% per the owner at 03:06, resets about 06:00 local). Anyone (person or agent) should be able to continue from this file plus the repo. For a per-item list in Portuguese see [tests-na-demo-notas.md](tests-na-demo-notas.md).

## What this is

The Hack4Guima artifact has a tab "Tests na demo" where testers list problems found in the demo (CesiumJS app in `web/`, API in `api/`). A Claude Code session ("Tests na demo issues", transcript `31519191-60ed-42f8-ab46-83d277de308c`) grouped those issues, delegated them to sub-agents (one git worktree + branch each, Sonnet), type-checked and merged each branch into the local `main`. **Items are not ticked in the artifact**; the solutions were only written beside them, on request.

## Where everything is

| Thing | State |
|---|---|
| Repo | `Atalaia/` (the only git repo under `Hack4Guimaraes/`; `FireRenderer/` and `FireTwinRender/` are separate UE5 projects) |
| Local `main` | 49 commits ahead of `origin/main` and **3 behind** (see "Bruno's newer push"), head `b01cce9`. **Not pushed.** Do not push `main` without the owner's yes; it lands in front of Bruno and the team |
| Shared branch | `tests-na-demo` on `github.com/brunosantospt/Atalaia` (head `546c69b`, merged from `main` at `add6b5b`). Has rounds 1 and 2, Bruno's merge, the Penha rebuild and the crash fix. The last 6 commits on `main` (T+0 fire, spotlight, close-up smoothing, ELMFIRE polled jobs) are **not** on it. Bruno can open a PR from it |
| Worktrees | `tests-demo/*` branches, checked out under the session's scratchpad `.../scratchpad/wt-*`. `git worktree list` shows them. Merged ones can be pruned |
| Uncommitted on main | `pitch/README.md`, `pitch/index.html`, `pitch/img/atalaia-logo-dark.svg` (another session's pitch work, leave alone) and the untracked notes file `docs/tests-na-demo-notas.md` |
| Not browser-tested | The sessions cannot render the 3D globe (no WebGL). Everything was checked with `tsc` and `vite build` plus diff reading |

## Run it

```bash
cd Atalaia/api && ./setup.sh && ./serve.sh      # API on 127.0.0.1:5181 (ELMFIRE runs)
cd Atalaia/web && npm install && npm run dev    # http://localhost:5173, proxies /api to 5181
cd Atalaia/web && npm run build                 # tsc --noEmit + vite build
cd Atalaia/web && npm run ils:check             # ILS regression check on the demo fires
```

Fires are chosen with the URL hash, for example `#VieiradoMinho_10082016`. The default is the Penha demo fire.

## Round 1 — merged into local `main` (also on `tests-na-demo`)

Branches `tests-demo/{reach,alerts,timeline,editor,firelook,penha-data,windshift,elmfire,penha-dramatic,fix-polyline,merge-bruno}`.

- **Reach (`reachLayer.ts`, `reach.ts`):** white lines removed; one green "Melhor caso · X ha" line (drone detects, first unit arrives on time). Satellite label "Satélite deteta o fogo · HH:MM". Ignition rings (1/2/5 km) removed.
- **Alerts (`web/src/alerts.ts`):** panel top right. Homes reached within 1 h (critical under 30 min), villages, units low on water, rate of spread (warning 16.8 m/min Scott & Burgan 2005, critical 50 m/min Tedim et al. 2018), wind. Clicking flies to the place.
- **Timeline / camera (`shots.ts`, `player.ts`, `main.ts`, `hud.ts`):** "Mira" crosshair coordinates at the screen centre, light follows the centre every frame, app starts paused (space plays), one shared fire clock for replay and editor slider, rebuilding a plan no longer zooms out. Open check: pressing R mid-story with the editor never opened should reset the fire.
- **Editor (`editor.ts`, `wetLine.ts`):** each ground unit lays a light-blue wet line across the spread direction (VFCI 300×10 m, VTTU 1200×15 m, crew 120×2 m), active from the unit's arrival minute, in exactly ELMFIRE's `decision.barriers` format; the fast model uses the same strips. Routes dark blue (`#1e3a8a`). Empty plan on start; "Repor exemplo" restores the example. One armed button per unit type, then a map click. Aircraft stay temporary slowdown zones (ELMFIRE barriers have no end time). Ground units have no flame-length limit.
- **Fire look (`splitLayer.ts`):** simulated fire drawn like the observed one (amber front line, soft amber for the last 30 min, dark ember behind), not pixels.
- **Penha demo fire (`scripts/build_hypothetical.py`, `web/public/fires/Penha_Guimaraes_hipotetico/`):** the only fire in `fires/index.json`. Real IFS meteo of 2024-09-16; wind turns at 12:30 (T+150) from E 23 km/h to NNW 36 km/h gusting 63, then strengthens to 65 km/h at 13:00. Tuned to the order of magnitude of Paredes 17 Sep 2024 (27 km grid, dry farmland in `fuel.json`).
- **Wind shift (`web/src/windShift.ts`):** playback pauses at the shift, opens "Mudança brusca de vento" with "Rever estratégia" / "Continuar sem alterar"; wind alert and a timeline marker.
- **ELMFIRE (`web/src/engines.ts`, `api/`):** Free, A and B run through the API for 24 h; "Fim do incêndio" shows "Extinto às HH:MM · N ha" or "Não extinto em 24 h". Falls back to the fast model with a warning if the API is down. Portuguese fuels and spotting from branch `hindcast-registos` exist in the API but are off by default (without canopy they over-burn Vieira).
- **Bruno's push merged (`merge-bruno`):** ILS moves units off and between A's lines and reshapes them (up to 300 m). `docs/ils.md` and `web/scripts/ils-reference.json` were refreshed because wet lines changed the model. B beats A: Vieira 260 ha vs 121 ha, Cabeceiras 595 ha (5 places) vs 473 ha (3 places).
- **Crash fix (`fix-polyline`):** Cesium threw "normalized result is not a number" on zero-length ground polylines. The app now drops repeated points and rings that are too short before drawing any ground line, and the Penha perimeters were cleaned (1,413 to 1,105 rings, specks under 0.5 ha removed).

## Round 2 — merged into local `main` (all but the last 4 commits also on `tests-na-demo`)

Triggered by the tester's report: with the slider at max the fire still spread everywhere even with units placed. Diagnosis: the API log showed 63 successful ELMFIRE runs that did react to units (Penha 24 h: none 514 ha, 2 VFCI about 517–533 ha, 2 VFCI + 3 crews 300 ha), but the fixed 300 m strips were tiny against a km-long front, the fast preview overshot (about 15,000 ha), and the API runs used different settings from the reference story run (4,700 ha). Merged in this order (branches `tests-demo/{d2-lines,d2-data,d2-flow,fix-t0}`):

1. **Growing wet lines (`d2-lines`, `2e82dc3`):** each ground unit keeps extending its line along the fire edge at its attack rate (VFCI about 300 m/h, Matos 2025; crews per fuel type), as pieces that each hold from the minute they are built, at most 12 distinct `from_min`, later cut to 6 by `fix-jobs`. Output is still ELMFIRE's barrier input.
2. **Data + API (`d2-data`, `a36d3f7`, `cb82208`):**
   - Penha ignition moved to Monte da Penha (41.428556, -8.271500).
   - The cached unattended reference run is capped at 2,000 ha.
   - Detection: drone at 10 min, satellite at 30 min.
   - API runs of this fire use the fire's own ELMFIRE engine settings (same as the reference).
   - New API `wind_shift` flag with a forecast file `weather_noshift.json` (the forecast without the shift), documented in the API docs.
3. **App flow (`d2-flow`, `7760e70`, `698188f`):**
   - ELMFIRE only on screen; no fast-model fire is ever shown. A "Simular no ELMFIRE" button runs A and B behind a loading screen, and every run is cut at the cap.
   - The opening is the director's step 1: drone sighting (T+10), satellite sighting (T+30), then the cached no-units ELMFIRE prediction.
   - **One wind incident:** plans are made on the forecast without the shift. At the shift, "Realocar meios" is the only way on, and a run with the new wind unlocks playback. This replaces the earlier "Rever estratégia" / "Continuar sem alterar" prompt.
4. **Fire at T+0 and spotlight (`fix-t0`, `70b85c5`, `603b8e6`; plus `65a7b06`, `eac5deb` on main):** the fire shows from T+0 using exact cells by minute, with a glow for tiny fires. The spotlight keeps one size on screen and is sized per shot only in the director's cut. Close-ups are smooth again with the T+0 fix kept.

The three `d2-*` worktrees have nothing left to merge and can be pruned (`git worktree remove`), as can the other merged `tests-demo/*` ones.

## Round 3 — after the tester's next reports

1. **Focus light and T+0 fire:** covered at the end of round 2 (`65a7b06`, `70b85c5`, `eac5deb`).
2. **ELMFIRE "NetworkError" after about a minute (`tests-demo/fix-jobs`, `1b17b1b`, merged at `b01cce9`):** the API answered 200, but the browser dropped one long-held request. A plan with growing lines splits an ELMFIRE run into up to 12 time stretches (one 24 h run took 77 s). Fix: `POST /api/jobs`, `GET /api/jobs/{id}[/result]`; the web (`engines.ts`, `busy.ts`) polls every 1.5 s with retries and falls back to `POST /api/run` on an old API. `MAX_FROM` cut from 12 to 6: the heavy run went from 79 s to 54 s, burned area +5.7 %. B still beats A but by less (Vieira 129 to 88 ha); `web/scripts/ils-reference.json` refreshed. Old cached runs are invalid (the first run of any plan recomputes, up to about 1 minute with many units). The API must be restarted to serve jobs. **Known problem:** `api/test.sh` still expects Vieira, which was removed from the fire list, so it fails.
3. **Fire stations (`tests-demo/station-rings`, worktree `wt-rings`): IN PROGRESS, nothing committed, not merged.** The worktree has uncommitted edits in `web/scripts/ils-check.ts`, `editor.ts`, `fastModel.ts`, `ledger.ts`, `main.ts`, `optimize.ts`, `shots.ts`, `style.css`. Request: a radius around the fire telling how far means can be placed, for each of the 3 closest *quartéis*, and only those 3 selectable. Design given to the agent:
   - The 3 stations closest to the fire by travel time are the only ones choosable, and B's optimizer uses only them (aircraft keep their air bases). One constant sets the 3.
   - One dashed ring per station, centred on the ignition, labelled like "B.V. Guimarães · chega T+18 min · até 1,4 km". Radius = how far the unconfined ELMFIRE fire has spread when that station's units arrive (drone detection at 10 min + turnout + road time) plus how far those units can work from the edge.
   - Shown while the decisions panel is open and in decision shots, with a legend toggle. Recomputed after the wind incident.
   - Placing a ground unit or line point outside its ring is refused with "Fora do alcance do <quartel> (máx. X km)"; B never places outside.
   To pick up: check the worktree's `git status`, finish or discard, run `cd web && npm run build` and `npm run ils:check`, then merge `tests-demo/station-rings` into `main`.

## Bruno's newer push — not merged yet

`origin/main` has 3 commits we do not have (PR #2 `api-hindcast-step3`, head `c910095`, Bruno Santos, 01:11–01:52): ELMFIRE adapter with `fuel_models`, `layers.adj`, spotting and seed (the hindcast overlay is dropped); API defaults now use hourly dead moistures, LiDAR canopy and burn scars; new `canopy_*` and `scars.geojson` data for Vieira and Cabeceiras. Next step: `git merge origin/main` into `main`, then re-run `npm run build`, `npm run ils:check` and a Penha no-units API run. Likely conflicts or behaviour changes are in `api/engines.py`, the engine block that `d2-data` added for Penha, and the Vieira and Cabeceiras numbers (canopy on by default changes burn areas, and the ILS reference in `web/scripts/ils-reference.json` may need a refresh, with a note in `docs/ils.md`).

## Open items and cautions

- Browser-test everything, especially: R resets the fire; Penha renders without the Cesium crash; the wind incident (pause at the shift, "Realocar meios", unlock after a new run); the loading screen blocking input; the "Simular no ELMFIRE" button enabling only after a layout change; the fire visible from T+0; alert click-to-fly; the 2,000 ha cap not looking truncated.
- Check that a no-units API run is within about 10 % of the reference at 6 h (the d2-data acceptance test), and that units now contain the Penha fire at 24 h.
- Push the latest `main` commits to `tests-na-demo` when the owner says so (it lacks the T+0 fix, focus light, polled jobs and the station rings).
- Restart the API (`api/serve.sh`) after pulling the jobs change, then retry "Simular no ELMFIRE" and confirm no "NetworkError".
- Satellite label wording is the session's own choice, because the doc text was cut off. Changing the HUD's big "Satélite" word is a one-line change if that was what the tester meant.
- The fast model is still used by the ILS (`optimize.ts`) and as a fallback. Do not delete it without a replacement for B's search.
- Usage-limit failures killed the Penha-data agent once; its uncommitted work stayed in its worktree and was resumed. If an agent dies, check its worktree before redoing anything.
- PT-FireSprd data (`FireRenderer/PT-FireSprd/`, Zenodo CC BY 4.0) carries an author note asking that the data be used only after the accompanying paper is officially published (questions: aklibenali@gmail.com). The tester asked about this and pasted an answer that a licence alone needs no permission, but the note is a request from the authors. Decide before using it in public material.
- `pitch/` has uncommitted edits from a different session. Do not commit them as part of this work.
