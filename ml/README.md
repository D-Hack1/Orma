# Synthetic federated-learning demo (A2.14)

No patient data or cloud access. All files and the environment stay under `ml/`.
Tested with Python 3.14.8. From the repository root:

```sh
python -m venv ml/.venv
ml/.venv/bin/python -m pip install -r ml/requirements.txt
ml/.venv/bin/python ml/fl_simulator.py
ml/.venv/bin/python -m unittest discover -s ml -p 'test_*.py' -v
```

The simulator also accepts `--seed 2026 --out ml/out`. The default seed and pinned
NumPy version reproduce numerical outputs; rendering can differ across platforms
and font installations. The exported `createdAt` is a fixed synthetic fixture
timestamp (not the actual run time), keeping JSON reproducible.

## Artifacts

- `out/initial_model.json`: **trained round-10 FL model**, used as the app's
  starting model. Matches `contracts/risk-features.md` v1 exactly: bias at weight
  index 0, 10 ordered/scaled features, fixed published reference means. Means are
  contract reference values, not statistics collected from real people.
- `out/fl_vs_central.png`: pitch chart, accuracy and ROC AUC at rounds 0–10.
- `out/metrics.json`: every plotted metric, log loss, eligible/excluded counts,
  majority-class accuracy, seed and training parameters.

No model is automatically uploaded, copied into the app, or deployed. Consumers
must preserve the feature order/scaling and label these predictions, never dose
facts. Contributions are **log-odds**, not percentage points or causal effects;
baseline logit plus all contributions equals the prediction logit.

## Experiment and honest interpretation

- 30 synthetic families, 1–3 members each; family-dependent night/weekend effects,
  weekday lunchtime nurse shifts, and memory-related drift in a subset.
- 7 warm-up dates, **30 training dates then 14 held-out dates** per member.
  History features use observations strictly before the prediction instant;
  7-day summaries exclude the current local date. Earlier holdout outcomes may
  inform later holdout features, as in rolling on-phone inference, but never
  update any fitted model. No shuffled train/test split or current-label feature.
- Known missed = 1, confirmed/reported full dose = 0. Unknown and partial rows
  are excluded, never pseudo-labelled missed. Histories belong to each member,
  and only eligible rows contribute to client sample counts.
- Every family participates in all 10 rounds. All three methods start with the
  contract's starter weights, same data, learning rate 0.08, minibatch size 16,
  and two shuffled SGD epochs per round. Independent seeded random streams
  separate noise, baseline training, FL training and data generation.
- FL resets each family to the current global model, trains locally, clips the
  **whole 11-value delta** to L2=1, adds independent Gaussian noise sigma=0.02,
  reclips to L2=1, and averages deltas weighted by eligible sample counts.
  Aggregation requires at least 5 clients. Synthetic clients are not real devices.
- Centralized trains on all pooled training rows (two epochs per round).
  Local-only keeps each family's own model across rounds and predicts only that
  family's held-out rows. Neither baseline clips/noises updates. Each method
  sees equal data passes, **not equal optimizer-step counts**: pooling yields
  more sequential minibatch steps than each parallel FL client.
- Metrics pool held-out rows, rather than giving tiny families equal weight.
  Accuracy threshold is 0.5. ROC AUC uses pooled rankings, half credit for ties;
  single-class AUC is undefined (`null`). Local-only's pooled AUC compares scores
  from different family models, not a single shared model.

Default seed 2026, round 10 (rounded; full precision in `metrics.json`):

| Method | Accuracy | ROC AUC | Log loss |
|---|---:|---:|---:|
| Federated | 0.6836 | 0.7482 | 0.5971 |
| Centralized | 0.6892 | 0.7483 | 0.5911 |
| Local-only | 0.6935 | 0.7553 | 0.5871 |

FL is close to centralized here, but **local-only slightly wins**. The desired
ordering in the project plan is an aspiration, not an assertion or test to game.
This is one synthetic seed, known families, and one short temporal holdout: no
confidence intervals, unseen-family generalization claim, clinical accuracy,
or evidence that reminders reduce missed doses. No test-set tuning is performed.

Clipping/noise is **not a formal differential-privacy guarantee**. There is no
privacy accountant, secure aggregation, live phone training, network simulation,
dropout model, or verified real-world consent/device eligibility in this offline
experiment. Do not claim individual updates cannot be isolated just because
there are five participants.

## Checks

The unittest suite checks contract order/reference means, chronological features
and exclusion windows, label counts, SGD direction, clip/noise/reclip (including
bias), weighted FedAvg and invalid updates, tied/single-class AUC, explanation
additivity, deterministic complete simulation, and readable PNG output.

For an additional artifact reproducibility check, rerun the CLI into a disposable
directory and compare its two JSON outputs with the checked-in outputs. PNG
bytes should also match on this pinned environment, but are not portable golden
test fixtures. No dependency on scikit-learn is needed for rank AUC.
