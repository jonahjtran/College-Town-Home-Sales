#!/usr/bin/env python3
"""Build the small files the map page loads, from data/college_town_home_sales.csv.

Run from the repository root:

    python3 scripts/build_map_data.py

Needs Python 3.9+ with pandas and numpy. The dataset is only read, never changed.
Running it again on the same CSV writes byte-identical files.

Writes to data/derived/:

    manifest.json           campus list, counts, map positions and the filter rules
    points_<slug>.json      one file per campus: one entry per sale, stored as columns
    distance_bands.json     per campus, price summaries by distance-to-campus band

Rules, following docs/data_description_sheet.md:

  * A sale is kept when PRICE_MIN <= sale_price <= PRICE_MAX and it has coordinates.
    The sheet warns that some prices are impossible ($0 up to $81,510,000).
  * Price per square foot is computed only where living_area_sqft > 0.
  * Summaries are medians and quartiles, never means, because the tails are long.
  * Rows are keyed by listing_id. Nothing is deduplicated by address.
  * home_type is not used.
  * Campuses come from the university column, not from city names.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "college_town_home_sales.csv"
OUT_DIR = ROOT / "data" / "derived"

PRICE_MIN = 1_000
PRICE_MAX = 5_000_000
THIN_BAND_SALES = 30  # bands with fewer sales than this are flagged "thin"

# Distance bands in miles. Each band includes its lower edge and excludes its upper edge.
# The last band has no upper edge.
BAND_EDGES = [0, 0.5, 1, 2, 3, 5, 10, None]

# File name slug and short display name for each value of the university column.
CAMPUSES = {
    "Purdue University": ("purdue", "Purdue"),
    "The Pennsylvania State University": ("penn-state", "Penn State"),
    "The University of Iowa": ("iowa", "Iowa"),
    "The University of North Carolina at Chapel Hill": ("unc", "UNC Chapel Hill"),
    "University of California, Davis": ("uc-davis", "UC Davis"),
    "University of Florida": ("florida", "Florida"),
    "University of Georgia": ("georgia", "Georgia"),
    "University of Illinois Urbana-Champaign": ("illinois", "Illinois"),
    "University of Michigan": ("michigan", "Michigan"),
    "University of Virginia": ("virginia", "Virginia"),
    "University of Wisconsin-Madison": ("wisconsin", "Wisconsin"),
}

EARTH_RADIUS_MILES = 3958.8


def haversine_miles(lat, lon, lat0, lon0):
    lat, lon, lat0, lon0 = map(np.radians, (lat, lon, lat0, lon0))
    a = np.sin((lat - lat0) / 2) ** 2 + np.cos(lat) * np.cos(lat0) * np.sin((lon - lon0) / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * np.arcsin(np.sqrt(a))


def locate_campus(lat, lon, miles):
    """Recover the campus landmark's position from the data itself.

    The dataset gives every home's coordinates and its straight-line distance to the
    campus landmark, but not the landmark's coordinates. This finds the point whose
    distances to the homes best match miles_to_campus (least squares, Gauss-Newton).
    Returns (lat, lon, rmse_miles, max_abs_error_miles).
    """
    nearest = np.argsort(miles)[:25]
    c = np.array([lat[nearest].mean(), lon[nearest].mean()])
    step = 1e-6
    for _ in range(50):
        r = haversine_miles(lat, lon, c[0], c[1]) - miles
        jac = np.column_stack([
            (haversine_miles(lat, lon, c[0] + step, c[1]) - miles - r) / step,
            (haversine_miles(lat, lon, c[0], c[1] + step) - miles - r) / step,
        ])
        delta = np.linalg.lstsq(jac, -r, rcond=None)[0]
        c = c + delta
        if np.abs(delta).max() < 1e-9:
            break
    r = haversine_miles(lat, lon, c[0], c[1]) - miles
    return float(c[0]), float(c[1]), float(np.sqrt((r ** 2).mean())), float(np.abs(r).max())


def quantile(series, q):
    """Quantile with linear interpolation, or None when there are no values."""
    series = series.dropna()
    if series.empty:
        return None
    return float(series.quantile(q))


def money(value):
    return None if value is None else int(round(value))


def rate(value):
    return None if value is None else round(value, 1)


def band_label(lo, hi):
    return f"{lo:g}+ mi" if hi is None else f"{lo:g}–{hi:g} mi"


def write_json(path, obj):
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    path.write_text(text + "\n", encoding="utf-8")
    return path.stat().st_size


def main():
    df = pd.read_csv(
        SOURCE,
        dtype={"zipcode": str, "county_fips": str, "parcel_number": str, "listing_id": str},
    )
    rows_in_source = len(df)
    if not df["listing_id"].is_unique:
        sys.exit("listing_id is not unique; stopping.")
    unknown = sorted(set(df["university"]) - set(CAMPUSES))
    if unknown:
        sys.exit(f"Unknown university values, add them to CAMPUSES: {unknown}")

    below = int((df["sale_price"] < PRICE_MIN).sum())
    above = int((df["sale_price"] > PRICE_MAX).sum())
    no_coords = int((df["latitude"].isna() | df["longitude"].isna()).sum())
    keep = (
        df["sale_price"].between(PRICE_MIN, PRICE_MAX)
        & df["latitude"].notna()
        & df["longitude"].notna()
    )
    kept = df[keep].sort_values("listing_id").copy()

    # Price per square foot only where the living area is a real, positive number.
    has_area = kept["living_area_sqft"] > 0
    kept["ppsf"] = (kept["sale_price"] / kept["living_area_sqft"]).where(has_area)
    kept["sale_year"] = pd.to_numeric(kept["sale_date"].str[:4], errors="coerce")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bands = [(BAND_EDGES[i], BAND_EDGES[i + 1]) for i in range(len(BAND_EDGES) - 1)]

    manifest_campuses = []
    band_output = {}
    sizes = {}

    for university in sorted(CAMPUSES, key=lambda u: CAMPUSES[u][1]):
        slug, short = CAMPUSES[university]
        every = df[df["university"] == university]
        sub = kept[kept["university"] == university]

        # Landmark position uses every row of the campus: it is geometry, not prices.
        c_lat, c_lon, rmse, max_err = locate_campus(
            every["latitude"].to_numpy(), every["longitude"].to_numpy(),
            every["miles_to_campus"].to_numpy(),
        )

        def column(series, digits=None):
            out = []
            for v in series.tolist():
                if v is None or (isinstance(v, float) and np.isnan(v)):
                    out.append(None)
                elif digits is None:
                    out.append(int(v))
                else:
                    out.append(round(float(v), digits))
            return out

        points = {
            "campus": slug,
            "count": len(sub),
            "lat": column(sub["latitude"], 5),
            "lon": column(sub["longitude"], 5),
            "price": column(sub["sale_price"]),
            "miles": column(sub["miles_to_campus"], 1),
            "beds": column(sub["beds"]),
            # null where the living area is missing or 0
            "sqft": column(sub["living_area_sqft"].where(sub["living_area_sqft"] > 0)),
            "year": column(sub["sale_year"]),
        }
        file_name = f"points_{slug}.json"
        sizes[file_name] = write_json(OUT_DIR / file_name, points)

        band_rows = []
        for lo, hi in bands:
            in_band = sub["miles_to_campus"] >= lo
            if hi is not None:
                in_band &= sub["miles_to_campus"] < hi
            b = sub[in_band]
            band_rows.append({
                "label": band_label(lo, hi),
                "min_miles": lo,
                "max_miles": hi,
                "sales": len(b),
                "thin": len(b) < THIN_BAND_SALES,
                "price_p25": money(quantile(b["sale_price"], 0.25)),
                "price_median": money(quantile(b["sale_price"], 0.5)),
                "price_p75": money(quantile(b["sale_price"], 0.75)),
                "ppsf_sales": int(b["ppsf"].notna().sum()),
                "ppsf_p25": rate(quantile(b["ppsf"], 0.25)),
                "ppsf_median": rate(quantile(b["ppsf"], 0.5)),
                "ppsf_p75": rate(quantile(b["ppsf"], 0.75)),
            })
        band_output[slug] = band_rows

        cities = every["city"].value_counts()
        manifest_campuses.append({
            "slug": slug,
            "short_name": short,
            "university": university,
            "points_file": file_name,
            "rows_in_source": len(every),
            "sales": len(sub),
            "cities": [{"city": c, "state": every.loc[every["city"] == c, "state"].iloc[0],
                        "rows_in_source": int(n)} for c, n in cities.items()],
            "campus_location": {
                "lat": round(c_lat, 5),
                "lon": round(c_lon, 5),
                "method": "least-squares fit to miles_to_campus",
                "fit_rmse_miles": round(rmse, 3),
                "fit_max_error_miles": round(max_err, 3),
            },
            "bounds": {
                "south": round(float(sub["latitude"].min()), 5),
                "west": round(float(sub["longitude"].min()), 5),
                "north": round(float(sub["latitude"].max()), 5),
                "east": round(float(sub["longitude"].max()), 5),
            },
            "price_median": money(quantile(sub["sale_price"], 0.5)),
            # Break points for the map's color scale
            "price_quantiles": {
                f"p{int(q * 100)}": money(quantile(sub["sale_price"], q))
                for q in (0.05, 0.2, 0.4, 0.6, 0.8, 0.95)
            },
            "ppsf_sales": int(sub["ppsf"].notna().sum()),
            "ppsf_median": rate(quantile(sub["ppsf"], 0.5)),
            "miles_median": round(quantile(sub["miles_to_campus"], 0.5), 1),
            "miles_max": round(float(sub["miles_to_campus"].max()), 1),
        })

    sizes["distance_bands.json"] = write_json(OUT_DIR / "distance_bands.json", {
        "thin_below_sales": THIN_BAND_SALES,
        "band_rule": "each band includes its lower edge and excludes its upper edge",
        "campuses": band_output,
    })

    sizes["manifest.json"] = write_json(OUT_DIR / "manifest.json", {
        "source": "data/college_town_home_sales.csv",
        "built_by": "scripts/build_map_data.py",
        "filters": {
            "price_min": PRICE_MIN,
            "price_max": PRICE_MAX,
            "rows_in_source": rows_in_source,
            "removed_price_below_min": below,
            "removed_price_above_max": above,
            "removed_missing_coordinates": no_coords,
            "rows_kept": len(kept),
            "ppsf_rule": "price per square foot only where living_area_sqft > 0",
        },
        "points_columns": {
            "lat": "latitude, 5 decimals",
            "lon": "longitude, 5 decimals",
            "price": "sale_price, US dollars",
            "miles": "miles_to_campus",
            "beds": "beds",
            "sqft": "living_area_sqft, null where missing or 0",
            "year": "year of sale_date, null where missing",
        },
        "campuses": manifest_campuses,
    })

    print(f"Rows in source: {rows_in_source:,}")
    print(f"Removed: {below} under ${PRICE_MIN:,}, {above} over ${PRICE_MAX:,}, "
          f"{no_coords} without coordinates")
    print(f"Rows kept: {len(kept):,}\n")
    print(f"{'campus':<18}{'sales':>7}{'median price':>14}{'landmark fit rmse (mi)':>24}")
    for c in manifest_campuses:
        print(f"{c['short_name']:<18}{c['sales']:>7,}{c['price_median']:>14,}"
              f"{c['campus_location']['fit_rmse_miles']:>24}")
    print("\nFiles written to data/derived/:")
    for name, size in sorted(sizes.items()):
        print(f"  {name:<28}{size / 1024:>8.1f} KB")


if __name__ == "__main__":
    main()
