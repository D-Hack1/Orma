# Risk / FL contract v1

One example = member × local date × slot, evaluated at scheduled time using only data strictly before that instant. Fixed feature vector has **10 values**; weights have **11 values**, bias at index 0, feature i weight at i+1. No one-hot slot expansion. All inputs clipped to [0,1] after the transformations below.

| index | featureNames entry | raw value → scaled value | missing default | featureMeans |
|---|---|---|---|---|
| 0 | slot | morning=0, noon=0.5, night=1 | required | 0.5 |
| 1 | weekend | member-local Saturday/Sunday=1 else 0 | 0 | 0.2857142857 |
| 2 | nurseOnShift | active assigned nurse at scheduled instant=1 else 0 | 0 | 0.4 |
| 3 | missRate7d | missed / eligible closed same-slot opportunities in previous 7 local dates | 0 | 0.2 |
| 4 | responseDelay | mean response minutes over previous 7 dates / 120 | 0 | 0.15 |
| 5 | snoozes7d | count in previous 7 dates / 14 | 0 | 0.1 |
| 6 | repeatedQuestions7d | repeat “did I take it?” beyond first per dose over previous 7 dates / 14 | 0 | 0.05 |
| 7 | daysSinceDose | elapsed hours since last confirmed/reported dose / 24 / 7 | 1 if never | 0.1 |
| 8 | lowStock | any scheduled medicine has <=7 days stock=1 else 0 | 0 | 0.2 |
| 9 | unknowns7d | closed Unknown outcomes over previous 7 dates / 21 | 0 | 0.1 |

Model fields: `{version,featureNames,weights,featureMeans,round,clients,createdAt}`. Starter means above are shared reference values, not claims about observed users. Initial weights `[-1.5,0.5,0.3,-0.6,1.4,0.5,0.4,0.6,0.8,0.3,0.9]`; simulator may replace weights/means but **not** order/scaling. Round means are fixed to model-published means, not uploaded from a live phone.

`z = weights[0] + sum(weights[i+1]*x[i])`; `p = sigmoid(z)`. Low p<0.35, med 0.35<=p<0.65, high p>=0.65. Baseline logit `b = weights[0] + sum(weights[i+1]*featureMeans[i])`; contribution `delta[i] = weights[i+1]*(x[i]-featureMeans[i])`. Thus `b+sum(delta)=z`, **not p**. Contributions are log-odds, not percentage points or causal claims. Top two positive contributions explain elevated predictions; don't invent positive reasons if none exist. Predictions never establish ingestion.

Training label: 1 only for a closed opportunity explicitly known missed, 0 for confirmed/reported full dose. Exclude pending, Unknown, partial and still-open windows (no pseudo-label from silence). `missRate7d` uses only these eligible outcomes. Synthetic fixture has `outcome:missed` with `status:unknown` to represent an explicit retrospectively confirmed omission; production records require an audited missed outcome, never assume every Unknown is missed.

FL submission delta is 11 elements including bias: localWeights - globalWeights. Clip entire vector L2 to 1.0; add independent Gaussian noise sigma=0.02 per coordinate; final reclip L2 to 1.0 (server bound includes noise). `n` = eligible training rows, integer 1..10000. Reject NaN/infinity, wrong length/order/version, norm>1+1e-6 or duplicate round/device. Round uses at least K=5 distinct consented T1 devices, sample-weighted delta `sum(n*delta)/sum(n)`; add it to base weights. Server-derived per-round pseudonym prevents duplicate submissions without public device IDs. T2 inference only; T3 local inference where cached model exists. Live training charging+Wi-Fi+idle+FL consent. Demo four simulated clients must be explicitly labelled simulated, not claimed as five real families. Clipping/noise is not a formal DP guarantee or secure aggregation.

Response delay, snooze, question and failed-voice signals remain on device. Do not seed/upload these as real family health records. Full feature contributions also stay local: with public weights/means, delta can reveal the feature value. Upload risk only by explicit sharing consent, using probability/level and coarse nonsensitive reasons (e.g. slot/weekend/nurse availability), not raw feature values or private contributions. Exact contribution bars are owner-local. Opt-in askedTwice digest text is separately consented and must not imply FL uploads these signals by default.
