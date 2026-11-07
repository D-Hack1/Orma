"""Reproducible synthetic FedAvg experiment. Run from any working directory."""

import argparse
import json
from pathlib import Path

import numpy as np

from synth_families import FEATURE_NAMES, INITIAL_WEIGHTS, REFERENCE_MEANS, make_families


ROUNDS = 10
LOCAL_EPOCHS = 2
LEARNING_RATE = .08
BATCH_SIZE = 16
CLIP_NORM = 1.0
NOISE_SIGMA = .02
MIN_CLIENTS = 5


def sigmoid(z):
    return 1 / (1 + np.exp(-np.clip(z, -700, 700)))


def train(weights, x, y, rng):
    weights = weights.copy()
    design = np.column_stack((np.ones(len(x)), x))
    for _ in range(LOCAL_EPOCHS):
        order = rng.permutation(len(y))
        for start in range(0, len(y), BATCH_SIZE):
            indices = order[start:start + BATCH_SIZE]
            batch = design[indices]
            weights -= LEARNING_RATE * (batch.T @ (sigmoid(batch @ weights) - y[indices])) / len(indices)
    return weights


def clip(delta):
    return delta * min(1., CLIP_NORM / max(float(np.linalg.norm(delta)), 1e-15))


def private_update(delta, rng):
    # Final clipping keeps the noisy update within the server's contract bound.
    return clip(clip(delta) + rng.normal(0, NOISE_SIGMA, len(delta)))


def fedavg(deltas, counts):
    deltas = np.asarray(deltas, dtype=float)
    counts = np.asarray(counts, dtype=float)
    if (deltas.ndim != 2 or deltas.shape[1] != 11 or len(deltas) < MIN_CLIENTS
            or counts.shape != (len(deltas),) or not np.isfinite(deltas).all()
            or not np.isfinite(counts).all() or (counts < 1).any()
            or (counts > 10000).any() or (counts != np.floor(counts)).any()
            or (np.linalg.norm(deltas, axis=1) > CLIP_NORM + 1e-6).any()):
        raise ValueError("Need >=5 finite bounded 11-value updates and integer sample counts 1..10000")
    return np.average(deltas, axis=0, weights=counts)


def metrics(y, p):
    """Pooled accuracy and rank AUC with half credit for tied scores."""
    positives = int(np.sum(y == 1))
    negatives = int(np.sum(y == 0))
    auc = None
    if positives and negatives:
        order = np.argsort(p, kind="stable")
        sorted_p = p[order]
        ranks = np.empty(len(p), dtype=float)
        starts = np.r_[0, np.flatnonzero(np.diff(sorted_p)) + 1]
        ends = np.r_[starts[1:], len(p)]
        for start, end in zip(starts, ends):
            ranks[order[start:end]] = (start + 1 + end) / 2
        auc = float((ranks[y == 1].sum() - positives * (positives + 1) / 2) / (positives * negatives))
    safe = np.clip(p, 1e-15, 1 - 1e-15)
    return {"accuracy": float(np.mean((p >= .5) == y)), "auc": auc,
            "logLoss": float(-np.mean(y * np.log(safe) + (1 - y) * np.log(1 - safe)))}


def simulate(seed=2026):
    families = make_families(seed)
    x = np.concatenate([f.train_x for f in families])
    y = np.concatenate([f.train_y for f in families])
    test_x = np.concatenate([f.test_x for f in families])
    test_y = np.concatenate([f.test_y for f in families])
    counts = [len(f.train_y) for f in families]
    # Independent streams: noise never changes data or baseline shuffles.
    streams = np.random.SeedSequence(seed).spawn(4)
    fl_rng, noise_rng, central_rng, local_rng = [np.random.default_rng(s) for s in streams]
    global_weights = INITIAL_WEIGHTS.copy()
    central_weights = INITIAL_WEIGHTS.copy()
    local_weights = [INITIAL_WEIGHTS.copy() for _ in families]
    history = []
    for round_id in range(ROUNDS + 1):
        if round_id:
            deltas = [private_update(train(global_weights, f.train_x, f.train_y, fl_rng)
                                     - global_weights, noise_rng) for f in families]
            global_weights += fedavg(deltas, counts)
            central_weights = train(central_weights, x, y, central_rng)
            local_weights = [train(w, f.train_x, f.train_y, local_rng)
                             for w, f in zip(local_weights, families)]
        local_p = np.concatenate([sigmoid(w[0] + f.test_x @ w[1:])
                                  for w, f in zip(local_weights, families)])
        history.append({"round": round_id,
                        "federated": metrics(test_y, sigmoid(global_weights[0] + test_x @ global_weights[1:])),
                        "centralized": metrics(test_y, sigmoid(central_weights[0] + test_x @ central_weights[1:])),
                        "localOnly": metrics(test_y, local_p)})
    model = {"version": f"synthetic-seed{seed}-r{ROUNDS}", "featureNames": FEATURE_NAMES,
             "weights": global_weights.tolist(), "featureMeans": REFERENCE_MEANS.tolist(),
             "round": ROUNDS, "clients": len(families), "createdAt": "2026-03-01T00:00:00Z"}
    report = {"syntheticOnly": True, "seed": seed, "families": len(families),
              "rounds": ROUNDS, "localEpochsPerRound": LOCAL_EPOCHS,
              "learningRate": LEARNING_RATE, "batchSize": BATCH_SIZE,
              "clipNorm": CLIP_NORM, "noiseSigma": NOISE_SIGMA,
              "trainDays": 30, "testDays": 14, "warmupDays": 7,
              "trainRows": len(y), "testRows": len(test_y), "familyTrainRows": counts,
              "excludedTrainRows": sum(f.excluded_train for f in families),
              "excludedTestRows": sum(f.excluded_test for f in families),
              "testMissRate": float(np.mean(test_y)),
              "majorityClassAccuracy": float(max(np.mean(test_y), 1 - np.mean(test_y))),
              "history": history}
    return model, report


def chart(report, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    for ax, metric, title in zip(axes, ("accuracy", "auc"), ("Accuracy (threshold 0.5)", "ROC AUC")):
        for key, label in (("federated", "Federated (clipped + noisy)"),
                           ("centralized", "Centralized"), ("localOnly", "Local-only (own family)")):
            ax.plot([r["round"] for r in report["history"]],
                    [r[key][metric] for r in report["history"]], marker="o", label=label)
        baseline = report["majorityClassAccuracy"] if metric == "accuracy" else .5
        ax.axhline(baseline, color="gray", linestyle=":", label="Majority / chance baseline")
        ax.set(xlabel="Round (2 epochs per model per round)", ylabel=title, ylim=(0, 1), xticks=range(11))
        ax.grid(alpha=.2)
    axes[0].legend(fontsize=8, loc="lower left")
    fig.suptitle(f"Orma: synthetic simulation only · 30 families · seed {report['seed']}")
    fig.text(.5, .02, "Later-date holdout, same families; not clinical evidence or a formal DP guarantee.",
             ha="center", fontsize=10)
    fig.tight_layout(rect=(0, .05, 1, .95))
    fig.savefig(path, dpi=160, metadata={"Software": "Orma synthetic FL simulator"})
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    args = parser.parse_args()
    model, report = simulate(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    for filename, data in (("initial_model.json", model), ("metrics.json", report)):
        (args.out / filename).write_text(json.dumps(data, indent=2, allow_nan=False) + "\n")
    chart(report, args.out / "fl_vs_central.png")
    print(json.dumps(report["history"][-1], indent=2))
    print(f"Artifacts: {args.out.resolve()}")


if __name__ == "__main__":
    main()
