"""Generate the small vector animation used by the cube's Rebuild button."""

import json
from pathlib import Path


def animated_position(start):
    end = [29, 20, 0]
    return {
        "a": 1,
        "k": [
            {"t": 0, "s": start, "e": end, "i": {"x": 0.65, "y": 1}, "o": {"x": 0.35, "y": 0}},
            {"t": 17, "s": end, "h": 1},
            {"t": 31, "s": end, "e": start, "i": {"x": 0.65, "y": 1}, "o": {"x": 0.35, "y": 0}},
            {"t": 48, "s": start},
        ],
    }


def face(name, vertices, color, start, index):
    return {
        "ddd": 0,
        "ind": index,
        "ty": 4,
        "nm": name,
        "sr": 1,
        "ks": {
            "o": {"a": 0, "k": 100},
            "r": {"a": 0, "k": 0},
            "p": animated_position(start),
            "a": {"a": 0, "k": [0, 0, 0]},
            "s": {"a": 0, "k": [100, 100, 100]},
        },
        "ao": 0,
        "shapes": [
            {"ty": "sh", "nm": "Face", "ks": {"a": 0, "k": {
                "c": True,
                "v": vertices,
                "i": [[0, 0]] * len(vertices),
                "o": [[0, 0]] * len(vertices),
            }}},
            {"ty": "fl", "nm": "Fill", "c": {"a": 0, "k": color}, "o": {"a": 0, "k": 100}, "r": 1},
            {"ty": "st", "nm": "Edge", "c": {"a": 0, "k": [0.24, 0.23, 0.22, 1]}, "o": {"a": 0, "k": 100}, "w": {"a": 0, "k": 0.7}, "lc": 2, "lj": 2},
        ],
        "ip": 0,
        "op": 48,
        "st": 0,
        "bm": 0,
    }


animation = {
    "v": "5.12.2",
    "fr": 30,
    "ip": 0,
    "op": 48,
    "w": 58,
    "h": 40,
    "nm": "Assembling cube",
    "ddd": 0,
    "assets": [],
    "layers": [
        face("Right", [[0, -2], [10, -7], [10, 5], [0, 10]], [0.66, 0.38, 0.23, 1], [48, 29, 0], 1),
        face("Left", [[-10, -7], [0, -2], [0, 10], [-10, 5]], [0.84, 0.52, 0.29, 1], [10, 29, 0], 2),
        face("Top", [[-10, -7], [0, -12], [10, -7], [0, -2]], [0.98, 0.72, 0.42, 1], [29, 0, 0], 3),
    ],
}

destination = Path(__file__).resolve().parents[1] / "src" / "lib" / "rebuild-lottie.json"
destination.write_text(json.dumps(animation, separators=(",", ":")) + "\n")
