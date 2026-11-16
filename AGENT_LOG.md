# Agent log

Add a dated entry each time you work with your AI coding agent, with the newest entry at the bottom. Each entry records what you asked the agent, what it produced, and what you checked or changed. Paste your key prompts in exactly as you typed them. Include at least one time the agent got something wrong, and how you caught it.

Copy this outline for each entry:

```markdown
## YYYY-MM-DD: What you worked on

- **Asked:** "Paste your prompt here."
- **Agent produced:** What it made or changed.
- **Checked or changed:** How you checked it, and what you fixed.
```

---

## 2026-11-10: Choosing what to build

- **Asked:** "What are some good ideas for this website."
- **Agent produced:** After reading `docs/data_description_sheet.md`, eight ideas: a campus comparison dashboard, a price-versus-distance view, an interactive map, days on market, seasonality, price per square foot, a budget tool and a data-quality page. It recommended starting with the comparison dashboard and the data-quality page.
- **Asked:** "I am between 2, 7 and 3. What do you suggest?"
- **Agent produced:** A recommendation to build the map (3) with the price-versus-distance idea (2) inside it, and to leave the budget tool (7) for later. Its reasons: the two ideas support each other, the budget tool needs the most code, and its medians can rest on very few homes in some towns.
- **Asked:** "Let's build 3 with 2 built in. I care about performance and speed. I want to add the script, as well as the script to pre-aggreggate into small summary files while keeping the dataset. Draft a plan of implementation"
- **Agent produced:** A four-step plan: a script that writes small files, the map page, the chart linked to the map, then polish. It also listed the design choices for speed: one small file per campus loaded only when picked, canvas drawing for the dots, and a pre-aggregated file for the chart. It ended with three questions about the price cap, the chart library and how to deliver the changes. As `AGENTS.md` requires, it changed nothing until the plan was approved.
- **Checked or changed:** The plan called the CSV "6 MB-ish". The agent's own `ls` of `data/` later showed it is 9 MB, and the agent used 9 MB from then on. The size only affected how the speed argument was worded.

## 2026-11-16: Building the map and the chart

- **Asked:** "I approve of this plan, start with step 1. Keep a professional UI"
- **Agent produced:** `scripts/build_map_data.py` and 13 files in `data/derived/`: a manifest, one points file per campus and a distance-band summary. It keeps sales priced from $1,000 to $5,000,000, which leaves 35,407 of 35,442. It also added a README section on how to rerun the script.
- **Checked or changed:** The agent ran the script twice and the output files were byte-for-byte the same. The points files and the band file each add up to 35,407 sales. It also recomputed three city medians from the data sheet (Davis $889,000, Urbana $229,900, Ann Arbor $571,000) and one band median separately, and they matched. The dataset files were not touched.
- **Asked:** "commit and push, then start step 2"
- **Agent produced:** The push was rejected because GitHub's copy of `main` already held an "Initial commit" that the local repository didn't. The agent compared the two with `git fetch` and `git diff`, found that the remote only had files the local copy also had, reset onto it without losing any files, committed again and pushed. It then built the map page: `index.html`, `css/site.css` and `js/map.js`.
- **Checked or changed:** **The agent got two things wrong, and testing caught both.** (1) It first used CARTO map tiles. A screenshot from a headless Chrome showed an "API KEY REQUIRED" watermark across the map, so it switched to OpenStreetMap tiles and toned them down with CSS. (2) On a phone-width screenshot the page overflowed sideways: the agent measured the page at 398 px wide in a 390 px window, because the campus dropdown and the color switch were wider than the screen. It changed the phone layout and measured 390 px afterward. The agent could not test hover, since headless Chrome can't hover, and said so.
- **Asked:** "I just pushed, continue"
- **Agent produced:** After confirming that the push of step 2, `4843257`, had arrived on `main`, it built step 3 in `js/chart.js`, `js/map.js`, `index.html` and `css/site.css`: an SVG chart of median price, or price per square foot, by distance band, with the middle half of sales as a bar. Bands with fewer than 30 sales show a dash. Hovering a band fades the other dots on the map, and clicking keeps the highlight. A table of the same numbers is available under the chart.
- **Checked or changed:** The agent checked the chart in a headless browser at desktop and phone widths, in light and dark mode, for Illinois and Purdue. The step 3 work was pushed as `eb3b36c`.
- **Asked:** "continue"
- **Agent produced:** It found that all four GitHub Pages runs had failed because Pages was not switched on for the repository, and said so rather than treating the site as live. It filled in the README (what the site is for, data notes, tools) and counted the figures it quotes from the data: 375 sales with no living area, 127 with a living area of 0, 34,905 sales usable for price per square foot, and 748 sales that share an exact map position with another sale.
- **Checked or changed:** Pages was then turned on for the repository and the site was published.
- **Asked:** "pages is published. Run the checks"
- **Agent produced:** Checks against the live site at https://jonahjtran.github.io/College-Town-Home-Sales/. Every file loaded, and the largest campus file is 69 KB compared with the 9 MB CSV. The summary tiles, the sale counts and the chart headlines for Illinois, Michigan and Purdue matched figures the agent recomputed from the CSV (for example Michigan's 0.5 to 1 mile median of $680,000 and Purdue's price per square foot of $168).
- **Checked or changed:** QA was done by interacting with the live site and hang testing features and functionality. Some features that were tested but not limited to were hover functionality, sorting, and mode switches (price to distance from campus).
- **Asked:** "fill in the agent log"
- **Agent produced:** This log, written from the session's record. It only includes things that happened in the session.