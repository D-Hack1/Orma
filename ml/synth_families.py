"""Synthetic, chronological dose opportunities; never real health records."""

from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np


# Fixed order/scaling from contracts/risk-features.md v1; bias is separate.
FEATURE_NAMES = [
    "slot", "weekend", "nurseOnShift", "missRate7d", "responseDelay",
    "snoozes7d", "repeatedQuestions7d", "daysSinceDose", "lowStock", "unknowns7d",
]
INITIAL_WEIGHTS = np.array([-1.5, .5, .3, -.6, 1.4, .5, .4, .6, .8, .3, .9])
REFERENCE_MEANS = np.array([.5, .2857142857, .4, .2, .15, .1, .05, .1, .2, .1])
TRAIN_DAYS = 30
TEST_DAYS = 14
WARMUP_DAYS = 7


@dataclass
class Event:
    at: datetime
    slot: int
    outcome: str
    response_minutes: float
    snoozes: int
    questions: int


@dataclass
class Family:
    train_x: np.ndarray
    train_y: np.ndarray
    test_x: np.ndarray
    test_y: np.ndarray
    excluded_train: int
    excluded_test: int


def features(at, slot, nurse, stock_days, history):
    """Build at scheduled instant, excluding current/future event information."""
    past = [e for e in history if e.at < at]
    start = at.date() - timedelta(days=7)
    recent = [e for e in past if start <= e.at.date() < at.date()]
    eligible = [e for e in recent if e.slot == slot and e.outcome in
                ("missed", "confirmed", "reported")]
    responses = [e.response_minutes for e in recent]
    taken = [e.at for e in past if e.outcome in ("confirmed", "reported")]
    return np.clip(np.array([
        slot / 2, float(at.weekday() >= 5), float(nurse),
        sum(e.outcome == "missed" for e in eligible) / len(eligible) if eligible else 0,
        np.mean(responses) / 120 if responses else 0,
        sum(e.snoozes for e in recent) / 14,
        sum(e.questions for e in recent) / 14,
        (at - max(taken)).total_seconds() / 3600 / 24 / 7 if taken else 1,
        float(stock_days <= 7), sum(e.outcome == "unknown" for e in recent) / 21,
    ]), 0, 1)


def make_families(seed=2026, count=30):
    rng = np.random.default_rng(seed)
    families = []
    for family_id in range(count):
        rows = [[], []]
        labels = [[], []]
        excluded = [0, 0]
        has_nurse = family_id % 3 == 0
        night_effect = rng.uniform(.3, 1.8)
        weekend_effect = rng.uniform(.1, 1.2)
        drift = rng.uniform(.2, 1.0) if family_id % 4 == 0 else 0
        family_bias = rng.normal(0, .35)
        # Unequal family sizes exercise sample-weighted aggregation.
        for _ in range(1 + family_id % 3):
            history = []
            member_bias = rng.normal(0, .2)
            for day in range(WARMUP_DAYS + TRAIN_DAYS + TEST_DAYS):
                memory = .15 + drift * day / (WARMUP_DAYS + TRAIN_DAYS + TEST_DAYS)
                for slot, hour in enumerate((8, 13, 20)):
                    at = datetime(2026, 1, 5, hour) + timedelta(days=day)
                    nurse = has_nurse and at.weekday() < 5 and slot == 1
                    stock_days = 28 - day % 28
                    x = features(at, slot, nurse, stock_days, history)
                    logit = (-2.1 + family_bias + member_bias + night_effect * x[0]
                             + weekend_effect * x[1] - 1.1 * x[2] + 1.2 * x[3]
                             + .6 * x[4] + .4 * x[5] + .6 * x[6] + .5 * x[7]
                             + .3 * x[8] + .5 * x[9] + memory)
                    missed = rng.random() < 1 / (1 + np.exp(-logit))
                    # Silence and partial doses never become missed-dose labels.
                    ambiguous = rng.random()
                    outcome = ("unknown" if ambiguous < .04 else "partial" if ambiguous < .08
                               else "missed" if missed else "reported" if nurse else "confirmed")
                    response = float(np.clip(rng.normal(15 + 35 * memory + 20 * missed, 12), 0, 180))
                    history.append(Event(at, slot, outcome, response,
                                         int(rng.poisson(.15 + .25 * memory)),
                                         int(rng.poisson(.05 + .35 * memory))))
                    if day < WARMUP_DAYS:
                        continue
                    split = int(day >= WARMUP_DAYS + TRAIN_DAYS)
                    if outcome in ("unknown", "partial"):
                        excluded[split] += 1
                    else:
                        rows[split].append(x)
                        labels[split].append(int(outcome == "missed"))
        families.append(Family(np.array(rows[0]), np.array(labels[0]),
                               np.array(rows[1]), np.array(labels[1]), *excluded))
    return families
