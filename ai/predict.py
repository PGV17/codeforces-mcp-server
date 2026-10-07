"""
ai/predict.py
─────────────
Lightweight TensorFlow rating predictor for the Codeforces AI Analytics Server.

Usage
-----
    python ai/predict.py '[1400, 1450, 1523, 1600, 1587]'

Output (stdout)
---------------
    {"predicted_rating": 1612, "trend": "improving", "confidence": "medium"}

The script trains a simple linear regression model (tf.keras Dense layer)
on the user's past rating sequence and predicts the NEXT contest rating.
Because Codeforces histories are typically short, we use a sliding-window
approach to create more training samples.
"""

import sys
import json
import math

# ── Suppress TensorFlow startup noise ──────────────────────────────────────────
import os
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

import numpy as np

# Lazy-import TensorFlow so we can surface a clear error if it's absent
try:
    import tensorflow as tf
    tf.get_logger().setLevel("ERROR")
except ImportError:
    print(json.dumps({"error": "TensorFlow is not installed. Run: pip install tensorflow"}))
    sys.exit(1)


# ── Helpers ────────────────────────────────────────────────────────────────────

def normalise(arr: np.ndarray):
    """Min-max normalise to [0, 1] and return (normalised, min, max)."""
    lo, hi = arr.min(), arr.max()
    if hi == lo:
        return np.zeros_like(arr, dtype=np.float32), lo, hi
    return ((arr - lo) / (hi - lo)).astype(np.float32), lo, hi


def make_windows(ratings: np.ndarray, window: int = 3):
    """
    Create (X, y) pairs using a sliding window.
    e.g. window=3: X=[r0,r1,r2] → y=r3
    """
    X, y = [], []
    for i in range(len(ratings) - window):
        X.append(ratings[i : i + window])
        y.append(ratings[i + window])
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)


def trend_label(ratings: list[float]) -> str:
    if len(ratings) < 2:
        return "unknown"
    delta = ratings[-1] - ratings[0]
    if delta > 50:
        return "improving"
    elif delta < -50:
        return "declining"
    return "stable"


def confidence_label(n: int) -> str:
    if n >= 10:
        return "high"
    elif n >= 5:
        return "medium"
    return "low"


# ── Main prediction logic ──────────────────────────────────────────────────────

def predict(ratings_raw: list[float]) -> dict:
    ratings = np.array(ratings_raw, dtype=np.float32)
    n = len(ratings)

    if n < 2:
        return {
            "predicted_rating": int(ratings[-1]) if n == 1 else 0,
            "trend": "unknown",
            "confidence": "low",
            "note": "Not enough data (need ≥ 2 contests).",
        }

    # Choose window size adaptively
    window = min(3, n - 1)

    # Normalise
    norm, lo, hi = normalise(ratings)

    # Build training data
    if n <= window:
        # Fallback: simple linear extrapolation via numpy polyfit
        x_idx = np.arange(n, dtype=np.float32)
        coeffs = np.polyfit(x_idx, ratings, 1)
        predicted = float(np.polyval(coeffs, n))
        predicted = max(0, round(predicted))
        return {
            "predicted_rating": predicted,
            "trend": trend_label(list(ratings)),
            "confidence": confidence_label(n),
            "note": "Used linear extrapolation (history too short for neural model).",
        }

    X_norm, y_norm = make_windows(norm, window)

    # ── Build & train a tiny Keras model ──────────────────────────────────────
    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(window,)),
            tf.keras.layers.Dense(16, activation="relu"),
            tf.keras.layers.Dense(8, activation="relu"),
            tf.keras.layers.Dense(1),  # linear output → regression
        ]
    )
    model.compile(optimizer=tf.keras.optimizers.Adam(0.01), loss="mse")

    # Train silently; early stop to avoid over-fitting short sequences
    cb = tf.keras.callbacks.EarlyStopping(monitor="loss", patience=20, restore_best_weights=True)
    model.fit(
        X_norm, y_norm,
        epochs=300,
        batch_size=max(1, len(X_norm)),
        verbose=0,
        callbacks=[cb],
    )

    # Predict the next rating using the last `window` values
    last_window = norm[-window:].reshape(1, window)
    pred_norm = float(model.predict(last_window, verbose=0)[0][0])

    # Denormalise
    if hi == lo:
        predicted = int(hi)
    else:
        predicted = int(round(pred_norm * (hi - lo) + lo))

    # Clamp to a sane Codeforces rating range
    predicted = max(0, min(4000, predicted))

    return {
        "predicted_rating": predicted,
        "trend": trend_label(list(ratings)),
        "confidence": confidence_label(n),
        "model": "keras_dense",
        "training_samples": int(len(X_norm)),
    }


# ── Entry-point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python predict.py '<json_array_of_ratings>'"}))
        sys.exit(1)

    try:
        ratings_input = json.loads(sys.argv[1])
        if not isinstance(ratings_input, list) or len(ratings_input) == 0:
            raise ValueError("Input must be a non-empty JSON array of numbers.")
        ratings_input = [float(r) for r in ratings_input]
    except (json.JSONDecodeError, ValueError) as e:
        print(json.dumps({"error": f"Invalid input: {e}"}))
        sys.exit(1)

    result = predict(ratings_input)
    print(json.dumps(result))
