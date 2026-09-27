"""
Turn MakeHuman's hair, eyebrow and eyelash textures into the ones the app draws.

`make-hair.mjs` runs this with one argument, a JSON list of jobs:

  [{"source": ".../long01_diffuse.png", "target": ".../long01.png", "size": 1024}, ...]

and reads one JSON object back from stdout: each target's `gain` (below).

Every card is tinted at draw time, so the colour MakeHuman painted it - bob02
is blonde, long01 brown, afro01 black - is thrown away and only its luminance
kept, as the grey channel of a grey-and-alpha PNG. What is left is the part of
a hair texture that is actually hair: the strands, the darker roots, the gaps
between locks. It is stretched so the brightest strands reach white, which
spends the eight bits on the detail rather than on the painted colour, and
`gain` is what undoes the stretch - the reciprocal of the texture's mean linear
luminance under its own alpha - so that a card drawn in colour c times gain
averages to c, whatever the source was painted.

The alpha is kept as painted. Under it, the grey of every clear texel is
replaced by that of the nearest strands, so mipmapping and bilinear filtering
blend a card's edge into more hair rather than into whatever MakeHuman left in
the transparent area, which is black on some textures and white on others and
shows as a bright or dark fringe round every card when a head is small on
screen.
"""

import json
import sys

import numpy as np
from PIL import Image


def linear(s):
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)


def encoded(l):
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(l, 1 / 2.4) - 0.055)


def box(values, radius, axis):
    padded = np.pad(values, [(radius + 1, radius) if a == axis else (0, 0) for a in range(2)], mode="edge")
    total = np.cumsum(padded, axis=axis)
    upper = np.take(total, np.arange(2 * radius + 1, total.shape[axis]), axis=axis)
    lower = np.take(total, np.arange(0, total.shape[axis] - 2 * radius - 1), axis=axis)
    return (upper - lower) / (2 * radius + 1)


def blur(values, radius):
    """Three box passes each way, which is a Gaussian to within a few percent."""
    for axis in (0, 1):
        for _ in range(3):
            values = box(values, radius, axis)
    return values


def convert(source, target, size):
    image = Image.open(source).convert("RGBA")
    if image.size != (size, size):
        # Premultiplied, or the clear texels' colour bleeds into the strands.
        image = image.convert("RGBa").resize((size, size), Image.LANCZOS).convert("RGBA")
    rgba = np.asarray(image, dtype=np.float64) / 255
    alpha = rgba[..., 3]
    rgb = linear(rgba[..., :3])
    luma = rgb @ np.array([0.2126, 0.7152, 0.0722])

    solid = alpha > 0.5
    if not solid.any():
        raise ValueError(f"{source} has no opaque texels")
    top = np.percentile(luma[solid], 98)
    grey = np.clip(luma / max(top, 1e-4), 0, 1)

    # Fill the clear texels outward from the strands, at widening radii, so the
    # nearest hair wins and nothing is left at the source's background.
    filled = grey.copy()
    known = alpha.copy()
    for radius in (1, 3, 8, 24, 64):
        weight = blur(known, radius)
        spread = blur(filled * known, radius) / np.maximum(weight, 1e-6)
        fresh = (known < 0.02) & (weight > 1e-4)
        filled = np.where(fresh, spread, filled)
        known = np.where(fresh, np.maximum(known, np.minimum(weight, 1)), known)
    mean = float((grey * alpha).sum() / alpha.sum())
    filled = np.where(alpha > 0.02, grey, filled)

    out = np.dstack([encoded(filled) * 255, alpha * 255]).round().clip(0, 255).astype(np.uint8)
    Image.fromarray(out, mode="LA").save(target, optimize=True)
    return 1 / mean


def main():
    jobs = json.loads(sys.argv[1])
    gains = {job["target"]: convert(job["source"], job["target"], job["size"]) for job in jobs}
    json.dump(gains, sys.stdout)


if __name__ == "__main__":
    main()
