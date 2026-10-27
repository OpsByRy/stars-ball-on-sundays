# Stars Ball On Sundays · public research website

This is the public presentation of SBOS's reviewed basketball research and recorded outcomes. It contains the website, brand assets, dated publication records with saved probabilities and projections, and standard odds/result utilities. Value Safe Picks and High-Probability Aggressive show the approved selections beside Ry’s favorites. SBOS Research also includes reviewed Not a Pick lines. Same-day price updates append a new edition, retain earlier snapshots and label unavailable prices or changed value checks. The proprietary research engine, raw source candidate data, training data, calculation rules, and internal evaluations are maintained separately.

Run `python3 scripts/build.py` to validate every publication and build `dist/`. Preview only that directory with `python3 -m http.server 8001 --directory dist --bind 127.0.0.1`. Run `python3 -m unittest discover -s tests` and `node --test tests/*.test.cjs` before publishing. No API key or paid data connection is needed to build this website.

Only files listed in `site-manifest.json` and validated edition records are deployed. Data accepts a small explicit schema, rejects unknown fields at every nesting level, verifies content hashes, and includes box-score identities only for published selections. Never copy an engine checkout, raw slate export, CSV, technical handoff, diagnostic report, or research screenshot into this repository.

The public record distinguishes Ry's personal favorites from exploratory SBOS research. Missing original publication times remain unavailable. Statistical outcomes do not verify sportsbook settlement or establish profitability. See [Our Philosophy](https://opsbyry.github.io/stars-ball-on-sundays/philosophy/) and the [evidence and results guide](https://opsbyry.github.io/stars-ball-on-sundays/guide/).

Research updates arrive as reviewed, sanitized records from the private publisher. Public code does not generate selections or infer model scores. The optional result refresher only checks already published contracts against public box scores; it cannot collect sportsbook odds or run the research algorithm.
