import json
import re
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from fl_simulator import chart, clip, fedavg, metrics, private_update, sigmoid, simulate, train
from synth_families import Event, FEATURE_NAMES, INITIAL_WEIGHTS, REFERENCE_MEANS, features


class SimulatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model, cls.report = simulate()

    def test_contract_order_and_reference_values(self):
        contract = (Path(__file__).parent.parent / "contracts/risk-features.md").read_text()
        rows = re.findall(r"^\| (\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$", contract, re.M)
        self.assertEqual([row[1].strip() for row in rows], FEATURE_NAMES)
        np.testing.assert_allclose([float(row[4]) for row in rows], REFERENCE_MEANS)
        self.assertEqual(self.model["featureNames"], FEATURE_NAMES)
        self.assertEqual(len(self.model["weights"]), 11)
        self.assertTrue(np.isfinite(self.model["weights"]).all())

    def test_features_use_only_past_and_correct_window(self):
        at = datetime(2026, 2, 10, 20)
        history = [Event(at - timedelta(days=1), 2, "missed", 60, 2, 1),
                   Event(at - timedelta(days=2), 2, "confirmed", 30, 1, 2),
                   Event(at - timedelta(days=3), 2, "unknown", 30, 0, 0),
                   Event(at - timedelta(days=8), 2, "missed", 120, 14, 14)]
        x = features(at, 2, True, 7, history)
        np.testing.assert_allclose(x, [1, 0, 1, .5, 1/3, 3/14, 3/14, 2/7, 1, 1/21])
        contaminated = history + [Event(at, 2, "missed", 120, 14, 14),
                                  Event(at + timedelta(days=1), 2, "confirmed", 120, 14, 14)]
        np.testing.assert_array_equal(features(at, 2, True, 7, contaminated), x)
        np.testing.assert_array_equal(features(at, 0, False, 8, []), [0, 0, 0, 0, 0, 0, 0, 1, 0, 0])

    def test_clip_noise_reclip_including_bias(self):
        delta = np.arange(1., 12.)
        np.testing.assert_allclose(np.linalg.norm(clip(delta)), 1.)
        rng = np.random.default_rng(8)
        expected = clip(clip(delta) + rng.normal(0, .02, 11))
        actual = private_update(delta, np.random.default_rng(8))
        np.testing.assert_array_equal(actual, expected)
        self.assertLessEqual(np.linalg.norm(actual), 1 + 1e-12)
        self.assertNotEqual(actual[0], clip(delta)[0])
        np.testing.assert_array_equal(clip(np.zeros(11)), np.zeros(11))

    def test_fedavg_is_sample_weighted_and_validates_bounds(self):
        deltas = np.zeros((5, 11))
        deltas[-1, 0] = 1
        counts = [1, 1, 1, 1, 6]
        self.assertAlmostEqual(fedavg(deltas, counts)[0], .6)
        invalid = [(deltas[:4], counts[:4]), (deltas, [0, 1, 1, 1, 6]),
                   (deltas, [1, 1, 1, 1, 1.5]), (deltas, [1, 1, 1, 1, 10001]),
                   (np.full((5, 11), np.nan), counts), (deltas * 2, counts),
                   (np.zeros((5, 10)), counts)]
        for updates, n in invalid:
            with self.subTest(n=n), self.assertRaises(ValueError):
                fedavg(updates, n)

    def test_auc_ties_single_class_and_accuracy(self):
        y = np.array([0, 1, 0, 1])
        self.assertEqual(metrics(y, np.array([.1, .9, .2, .8]))["auc"], 1.)
        self.assertEqual(metrics(y, np.full(4, .5))["auc"], .5)
        self.assertEqual(metrics(y, np.array([.9, .1, .8, .2]))["auc"], 0.)
        self.assertEqual(metrics(y, np.array([.1, .9, .2, .8]))["accuracy"], 1.)
        self.assertIsNone(metrics(np.zeros(4), np.zeros(4))["auc"])

    def test_sgd_reduces_training_loss_without_mutating_base(self):
        rng = np.random.default_rng(4)
        x = rng.random((200, 10))
        y = np.ones(200)
        base = np.zeros(11)
        fitted = train(base, x, y, rng)
        self.assertLess(metrics(y, sigmoid(fitted[0] + x @ fitted[1:]))["logLoss"], np.log(2))
        np.testing.assert_array_equal(base, np.zeros(11))

    def test_full_simulation_is_reproducible_and_labels_are_eligible(self):
        model, report = simulate()
        self.assertEqual((model, report), (self.model, self.report))
        self.assertEqual(report["families"], 30)
        self.assertEqual(len(report["history"]), 11)
        self.assertEqual(report["trainRows"] + report["excludedTrainRows"], 60 * 30 * 3)
        self.assertEqual(report["testRows"] + report["excludedTestRows"], 60 * 14 * 3)
        self.assertGreater(len(set(report["familyTrainRows"])), 1)
        initial = report["history"][0]
        self.assertEqual(initial["federated"], initial["centralized"])
        self.assertEqual(initial["federated"], initial["localOnly"])
        self.assertNotEqual(model["weights"], INITIAL_WEIGHTS.tolist())
        baseline = np.array(model["weights"])[0] + np.array(model["weights"])[1:] @ REFERENCE_MEANS
        x = np.linspace(0, 1, 10)
        contributions = np.array(model["weights"])[1:] * (x - REFERENCE_MEANS)
        self.assertAlmostEqual(baseline + contributions.sum(), model["weights"][0] + np.array(model["weights"])[1:] @ x)
        # Serialization rejects non-finite output, rather than emitting invalid JSON.
        json.dumps((model, report), allow_nan=False)

    def test_chart_is_readable_png(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "chart.png"
            chart(self.report, path)
            with Image.open(path) as image:
                self.assertEqual(image.format, "PNG")
                self.assertEqual(image.size, (1920, 800))
                image.verify()


if __name__ == "__main__":
    unittest.main()
