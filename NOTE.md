# Training-run monitor — note

**Repo:** https://github.com/Albinous/run-monitor · **Live:** https://albinous.github.io/run-monitor/ · Vite + React + TS, own Canvas 2D renderer, Vitest.
Tests: `npm test` → [test-output.txt](test-output.txt) (46/46). Bench: `npx vite-node scripts/bench.ts` → [bench-output.txt](bench-output.txt). Features and screenshots: [README](README.md).

## 1. How the chart stays truthful

Sort by step → duplicate steps: _last write wins_ (resume from checkpoint) → split each metric into **segments** that never cross NaN/±∞, a logging gap (> 3× median stride) or, on log axes, a value ≤ 0 → **M4 per pixel column** (first/min/max/last, 64-point block min/max index) → y range from the **raw extent in view**, not from the downsampled or smoothed line. Values that can't be drawn become markers (NaN = red dashed band, ±∞ = triangle at the edge, ≤ 0 on log = ▼) and are counted under the chart.

## 2. What the tests prove — and what they don't

- **Spike:** on the 1M run, for 3 widths × 16 zoom levels (1M → 30 steps) × 4 spike positions, the spike is in the drawn line, is its highest point, and is > 40% of the plot height above the baseline. Still drawn with EMA 0.99. Out of view, the y max drops.
- **Oracle:** for 4 windows, the per-pixel-column min/max of the M4 line equals that of drawing all 1M points.
- **NaN/±∞:** excluded from the y range, the line breaks exactly at them, markers sit at the exact steps; a recording fake canvas context gets **no NaN coordinate and no `lineTo` through the NaN step**; EMA restarts after NaN; a lone point between two NaNs is drawn as a dot.
- **Duplicates/unsorted:** reversed input + 500 stale duplicates draws a **pixel-identical** line to the clean input; gaps break the line.
- **Numbers:** every tick label parses back to its value and sits at the right pixel; summary cards match a separate brute-force calculation on the raw input.
- **Tests that catch a real break:** removing the max point from M4 fails 3 tests; letting NaN into segments fails 5; removing the race guard fails 3.

**Not caught:** (1) rasterization — a 1-sample spike is a 1-px line a human can still miss; (2) visual overlap and real-screen contrast; (3) the React layer — the race guard is tested, the hook + component together are not (no E2E); (4) shared assumptions — generator and tests agree on "last write wins"; if that's wrong for real logs, everything still passes; (5) `Intl` differences between browsers; (6) perf regressions; (7) a real JSON API, where NaN/Infinity silently become `null`.

## 3. Performance (1M points)

|                                                                   | Draw every point (`?render=naive`)   | M4 + block index + cursor overlay |
| ----------------------------------------------------------------- | ------------------------------------ | --------------------------------- |
| Frame compute, full view (Node, median / p90)                     | 25.7 / 39.8 ms                       | 1.7 / 4.6 ms                      |
| Points sent to canvas, full view                                  | 1,000,000                            | 3,195                             |
| Browser, compute + draw of 3 charts, first render (no throttling) | ≈ 72 + 55 ms                         | ≈ 14 + 5 ms                       |
| Hover                                                             | redraw of all 1M points (one canvas) | overlay redraw only (≈ 2 ms)      |
| JS heap at 1M points                                              | 77 MB                                | 48 MB                             |
| **First render / zoom / hover, CPU ×4 (DevTools trace)**          | `<fill in>`                          | `<fill in>`                       |

The browser rows come from an embedded Chromium without throttling and are indicative only. Still on the main thread: generating the 1M run (~190 ms) and cleaning + indexing (~55 + 3×30 ms) → one long task on first open. **Next: move cleaning and indexing into a Web Worker.**

## 4. Silent failures — what I checked and how

- **Request race** (`[`/`]` spam; `r02` answers in 2.5 s): the previous request is aborted _and_ late answers are dropped by sequence number, so it works even if the backend ignores abort; the page never renders data whose id ≠ the current id. Tested: slow A / fast B, A→B→C, stale errors, cancel on leave.
- **Stale data:** "data as of … (N s ago)" on every run; the live run `r12` polls every 3 s and fails ~30% of the time → **STALE DATA** banner instead of old numbers that look current.
- **Locale & time zone:** all formatting via `Intl` with an explicit locale, display strings are never parsed back, dates always show the zone, sorting uses timestamps. Tested: the same instant is Nov 5 in Tokyo and Nov 4 in LA; de-DE date strings don't sort in time order. By hand: `?locale=de-DE&tz=Asia/Tokyo`.
- **Smoothing hides divergence:** `r13` explodes in its last 150 steps; EMA 0.99 shows the final loss > 2× too low (tested). Smoothing is off by default, the raw line is always drawn, the cards use raw values ("Recent trend +40%").
- **Log scale with zeros:** lr starts and ends at exactly 0; on log axes zeros are ▼ markers with a counter, never `log(0) = −∞`.
- **Found along the way:** the list showed the last _finite_ loss, so a diverged run looked healthy → now the value at the last step (NaN). That exposed a second bug: sorting by that column put NaN in a random place (every comparison with NaN is false) → NaN now sorts last; checked by hand in both directions.

## 5. Verdict: **DON'T SHIP** (yet) for a $500 stop/continue decision

I trust the chart itself: the tests pin down the properties that matter. But (1) the data path is a mock, and a real JSON API has no agreed format for NaN/Inf, so NaN could silently arrive as `null` → 0; (2) opening a 1M run blocks the main thread; (3) there are no E2E or visual tests; the ×4 trace is `<recorded / not recorded>`. **First change:** define the wire format for non-finite values and test it end to end. Second: move cleaning to a Worker.

## What surprised me / what still concerns me

`<write in your own words>`

## AI tools

`<fill in honestly: what was generated by an AI assistant, which suggestions you accepted, what you checked, changed or redid yourself>`
