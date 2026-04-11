# U.S. Treasury Yield Curve Dashboard

Static frontend dashboard for inspecting the U.S. Treasury Daily Treasury Yield Curve Rates series from a browser, with no backend and no database.

I built this with Codex for daily personal use, because I prefer a plot to a table and I wanted a more customizable version of https://www.ustreasuryyieldcurve.com/ for following U.S. Treasuries. It's a simple locally run site that fetches the latest yields from the Official U.S. Treasury Daily Treasury Par Yield Curve Rates page:
  [home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve) 
and generates visuals.


## Data Source

Live fetch path used by the app:

- Official paginated Treasury XML feed for the full history:
  [home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=all&page=0](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=all&page=0)

Fallbacks:

- `data/sample_treasury_yields.csv` bundled with the project
- drag-and-drop CSV upload
- file picker upload

## How To Run

To run it in the background without needing to restart from the terminal, from the project directory:

```bash
python3 -m http.server 8000 &
```

Then open:

- [http://localhost:8000](http://localhost:8000)

To stop it later:
```bash
lsof -i :8000
kill -9 <PID>
```

## Dashboard Behavior

### Latest Yield Curve

- Plots the latest available curve in the loaded dataset (automatically fetched from the [Official U.S. Treasury Site](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve")

![Latest Yield Curve](images/yield_curve.png)

### Historical Comparison

- Overlay curves of selected dates
![Overlayed Yield Curve](images/overlay_curve.png)


`max steepening` and `max inversion` are based on the `10Y - 2Y` spread in the loaded sample.

### Spread Summary

The spread cards highlight:

- `10Y - 2Y`
- `30Y - 10Y`
- `5Y - 3M`

Each card shows latest spread in basis points, in percent, and a compact sparkline
![Overlayed Yield Curve](images/key_spreads.png)


### Historical Yields

- Time series of selected maturity yields with range slider
![selected_maturities](images/selected_maturities.png)

## PCA Loadings

Method used in `script.js`:

1. Build the historical daily matrix from maturities with sufficient coverage.
2. Use a coverage threshold to select common maturities across the sample.
3. Drop rows with missing values across the chosen PCA maturities.
4. Mean-center each maturity series across time.
5. Compute the covariance matrix of the centered matrix, either on yield levels or on daily first differences.
6. Extract the top 3 eigenvectors from the singular vector matrix after perfomring SVD.
7. Compute score time series for PC1, PC2, and PC3.
8. Orient component signs toward the usual fixed-income interpretation:
   - PC1: level / parallel shift
   - PC2: slope / steepener
   - PC3: curvature / twist

### Regime-Aware PCA

You can choose:

- `Full Sample`: stable long-run basis across all complete rows
- `Rolling Window`: trailing-window PCA recomputed for each date
- `Custom Date Range`: PCA fit only on the chosen start/end window
- `Preset Regimes`: named environment classifications such as `Tightening Cycles`, `Crisis Easing`, `ZLB / QE`, `Restrictive Plateaus`, `Transitional / Anomalous`, and `All History`

Preset regimes can span multiple disjoint windows. The PCA fit uses the union of those windows only.

### Levels Vs Daily Differences

- `Levels`L  fit PCA on the yield curve level matrix after mean-centering. Captures the dominant structure of the curve level across time.
- `Daily Differences`L fit PCA on first differences of yields, maturity by maturity, after mean-centering the differenced matrix. Useful when secular trend shifts dominate the sample and you want to isolate day-to-day co-movement instead.

#### Why Care About This?

Let's look at the 2022–2023 rate hiking cycle. From a macro perspective:

- The FED executed one of the fastest hiking cycles in decades
- The entire yield curve moved upward
- At the same time, the curve inverted significantly, so you might expect slope (PC2) to become more important

But when you run PCA on yield levels over this window, you see:

![Levels PCA](images/levels_pca_2022_2023.png)

PC1 dominates (~96.2% of variance)
PC2 collapses (~3.2% of variance)
PC3 negligible (~0.5%)

This looks off. Why is the steepening axis capturing so little variance? In a hiking cycle, we expect the front end to be more volatile than the tail, and so we would expect PC2 to capture more variance.

But during 2022–2023, the PC1 scores were consistently rising:

![Scores PCA](images/levels_scores_2022_2023.png)

i.e. there was a large, persistent upward shift in rates across all maturities, which we can also see here:

![Selected Maturities Inversion](images/selected_maturities_2022_2023.png)

Even though the curve inverted, those slope changes were small relative to the total level shift.

So PCA assigns almost all variance to PC1 (level).

When we switch the transformation to Daily Differences.

This removes the long-term trend and focuses on day-to-day co-movement.

In the same 2022–2023 window, we now observe:

![Diffs PCA](images/diffs_pca_2022_2023.png)

PC1 drops (~81.0%)
PC2 increases meaningfully (~10.5%)
PC3 becomes visible again (~4.9%)

This reflects the fact that day-to-day moves during the hiking cycle were not purely parallel shifts

Levels PCA captures macro regime shifts dominated by large structural repricing, wher Daily Differences PCA captures more trading-relevant dynamics of how different parts of the curve move relative to each other

### Preset Regimes

It is interesting to compare the regime-dependent PCs to the global baselines.

For example, lets use the preset regime "Tightening Cycles - Bear Flattener", where the included windows are: 2004–2006, 2016–2018, 2022–2023.

In these environments, what would we expect to see in the level PCs?
- Policy expectations get repriced, and these are embedded in the short-end (1M-2Y), so we expect the head to rise sharply. 
- THe long end yields (10Y-30Y) are rising, but more modestly because theyre constrained by long-run inflation expectations, growing recession risk, etc. So what does this imply for the covariance structure between yields (what the PCs capture)?
- Variance gets concentrated at the front end and movements get less uniform across maturities. So what do we expect from the level PCs:

-PC1 (shift): tilt toward shorter maturities, since most of the cross sectional variance is driven by the front end repricing rather than parallel shift across the curve.

-PC2 (Slope): Would become sharper and more front-end driven, plateauing in the long maturities to capture the divergence between rising short rates and stable long rates

-PC3 (Curvature): Would expect the hump to shift forward to reflect the biggest local distortion occuring between 2Y-5Y yields.

![Levels PCA Tightening](images/levels_pca_tightening.png)

We see exactly this, relative to the all-data baseline. 

Some more examples of preset regimes:

Crisis Easing - Bull Steepener (2000–2003, 2007–2008):

Levels:
![Levels PCA Easing](images/levels_easing.png)

Diffs:
![Diffs PCA Easing](images/diffs_easing.png)


Zero-Lower bound / Quantitative Easing rate environments (2009–2015, 2020–2021):

Levels:
![Levels PCA ZLB](images/levels_zlb.png)

Diffs:
![Diffs PCA ZLB](images/diffs_zlb.png)

Restrictive Plateaus (2006–2007, 2023–2024):

Levels:
![Levels PCA Plateau](images/levels_plateaus.png)

Diffs:
![Diffs PCA Plateau](images/diffs_plateaus.png)


## Refreshing Data

### In the app

1. Click `Refresh Official Data`.
2. Wait for the official XML history to load.
3. If you want a replaceable local snapshot, click `Download Current CSV`.
4. Move the downloaded CSV into `data/sample_treasury_yields.csv` if you want the bundled fallback updated.

### Manual fallback workflow

If live fetches are blocked:

1. Obtain an official Treasury CSV or export a normalized CSV from the dashboard.
2. Save it as `data/sample_treasury_yields.csv`.
3. Serve the project locally with `python3 -m http.server`.

## Limitations

- The `20Y` series has less historical coverage than the longer-running benchmark maturities.
- Rolling-window PCA is more computationally expensive than full-sample PCA. The app caches rolling results by transformation plus window length.
