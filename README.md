# College-Town Home Sales

## What this site is for

This site asks one question: does it cost more to live near campus? It is for anyone comparing housing around a university, such as students, parents, staff and people moving to a college town.

Pick one of 11 campuses to see every home sale around it on a map, colored by sale price or by distance to campus. A chart under the map shows the median sale price, or the median price per square foot, in each distance band from campus. Hovering over a band in the chart highlights its homes on the map.

## Live site

https://jonahjtran.github.io/College-Town-Home-Sales/

## Data notes

Every number on the site is computed from `data/college_town_home_sales.csv` by `scripts/build_map_data.py`. Nothing is typed in by hand.

**Rows left out**

- The site shows sales priced from $1,000 to $5,000,000. The dataset contains impossible prices, from $0 up to $81,510,000, so 35 of its 35,442 rows are left out: 4 under $1,000 and 31 over $5,000,000. That leaves 35,407 sales.
- Price per square foot uses only sales with a living area above 0. Of the 35,407 sales, 375 have no living area and 127 have a living area of 0, which leaves 34,905.
- No row is removed for any other reason.

**How each figure is defined**

- **Campus:** each sale belongs to the campus in its `university` column, which the dataset assigns from the home's coordinates. City names play no part.
- **Median sale price:** the middle `sale_price` of the sales shown. The site uses medians and never means, because a few very expensive homes pull a mean upward.
- **Median price per sq ft:** the median of `sale_price` divided by `living_area_sqft`, one value per sale.
- **Distance to campus:** `miles_to_campus`, the straight-line distance to one landmark on each campus. It is not driving distance.
- **Distance bands:** 0–0.5, 0.5–1, 1–2, 2–3, 3–5, 5–10 and 10+ miles. Each band includes its lower edge and not its upper edge.
- **Middle half:** the range from the 25th to the 75th percentile of a band's sales.
- **Thin bands:** a band with fewer than 30 sales shows a dash and no median. This applies to 19 of the 77 campus bands, mostly 0–0.5 miles and 10+ miles.
- **Map colors by price:** the five colors split each campus's sales into fifths, so the price ranges differ from campus to campus. The color key shows the ranges.
- **Campus marker:** the dataset gives each home's distance to the campus landmark but not the landmark's coordinates. The script finds the point whose distances to the homes best match `miles_to_campus`. The match is within about 0.05 miles for every home, which is the rounding of that column.

**The five problems in the description sheet**

1. **Days on market:** the site doesn't use it, or any of the three dates except the year of `sale_date` in a dot's details.
2. **Street addresses are not unique:** rows are keyed by `listing_id` and nothing is deduplicated by address. Units in the same building share coordinates, so their dots sit on top of each other: 748 of the sales shown share an exact position with at least one other sale, at 158 positions.
3. **Impossible prices:** handled by the $1,000 to $5,000,000 rule above.
4. **`home_type` is unreliable:** the site doesn't use it.
5. **Impossible values:** a living area of 0 is excluded from price per square foot, as above. The site doesn't use lot size, bathrooms or tax amounts.

The dataset is a copy of what one source reported in March 2026, and it has not been checked against county records.

## How the site's data files are made

The site never loads the full 9 MB CSV. `scripts/build_map_data.py` reads `data/college_town_home_sales.csv` and writes small files to `data/derived/`:

| File | What it holds |
|---|---|
| `manifest.json` | The 11 campuses, their sale counts and map positions, and the filter rules with the number of rows each removed |
| `points_<campus>.json` | One file per campus, with each sale's coordinates, price, distance to campus, bedrooms, living area and sale year |
| `distance_bands.json` | For each campus, the number of sales, median price and median price per square foot in each distance band |

To rebuild them, run this from the repository root. It needs Python 3.9 or later with pandas and numpy, and it writes identical files each time:

```
python3 scripts/build_map_data.py
```

The script keeps sales priced from $1,000 to $5,000,000, which leaves out 35 of the 35,442 rows (4 under $1,000 and 31 over $5,000,000). Price per square foot is computed only where the living area is above 0. The dataset doesn't give campus coordinates, so the script works out each campus landmark's position from the homes' coordinates and their `miles_to_campus` values.

## Tools we used

- **Claude Code** (Anthropic), the AI coding agent that wrote the script and the site, using the Claude Sonnet 5.5 and Claude Fable 5.2 models
- **Leaflet 1.9.4** for the map, loaded with a script tag from cdnjs
- **OpenStreetMap** for the street map behind the dots
- **Python with pandas and numpy** for the script that makes the site's data files
- **GitHub Pages** to publish the site
- The chart is drawn as SVG by `js/chart.js`, with no chart library

## Citation

College-town home sales dataset, version 1.0 (2026). University of Illinois-Deloitte Foundation Center for Business Emerging Technologies. Data collected March 2026.

## Who did what

_For teams: replace this line with each member's name and what they did. If you worked alone, delete this section._
