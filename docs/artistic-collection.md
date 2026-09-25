# 1,283 ready-to-view artistic compositions

See the [verification report](artistic-collection-verification.md) for exact
render coverage, screenshots and remaining geometry limitations.

Open a source-linked card in **Positions**, choose **••• Position details**, then
**Open artistic interpretation**. Every one of the 1,283 source IDs has an
included **Artistic 3D** composition; no import, manual editing or local library
initialization is required. All 2,567 participants are retained: 12
solo records, 1,258 pairs and 13 three-person compositions. Clothed figures are
displayed separately on a neutral floor.

These are **original artistic interpretations**, not reconstructions of source
images or sexual interactions. The user explicitly approved creative variations
because the source labels cannot determine exact 3D coordinates. The source
association preserves ID and annotation fingerprint for catalog continuity,
not an assertion that the artistic geometry matches that source.

## Designed content, not cosmetic duplicates

The content vocabulary uses eight whole-body bases: standing, upright kneeling,
low kneeling, floor sitting, supine, supine with raised legs, side lying and
squatting. Twenty designed arm gestures include open/forward/diagonal/overhead
reaches, bent-elbow frames, resting and asymmetric gestures. Gaze directions
are separated by 25 degrees. A side-lying figure retains its supporting lower
arm and varies the free arm instead of applying incompatible bilateral gestures.

Broad source posture families guide palette selection. Ambiguous or supported
source families receive grounded artistic alternatives, not invented suspension
or furniture. Whole bodies are composed into separate studies with a targeted
0.6 m gap between coarse bounds along world X. Upright figures are listed first
so the unchanged legacy solver does not infer partner support for independent
recumbent/upright pairs.

The final collection uses **141 body/gesture motifs**, with gaze variants giving
**403 pose/gesture/gaze motifs in 1,283 compositions**.
This is a reproducible designed variation system, not 1,283 individually
hand-sculpted base poses. Every full composition has a distinct skeletal joint
signature, even when head/neck angles, actor order, body/model choice, root
placement, camera, titles and colours are ignored. Signatures quantize body-joint angles in 10-degree bins
to exclude numerical noise. The closest two equal-participant-count compositions
differ by **at least 25 degrees in a limb or torso joint**, even after optimal
actor matching. A head turn alone never counts as a new composition.

## Playback, personal overrides and fallback

The 4,359,190-byte pack is committed at
`public/catalog/artistic-studies-v1.json`; `src/data/artistic-manifest.json`
records its size, SHA-256, counts and semantics. It loads lazily on first artistic
selection with bounded download, hash and strict scene/source validation. It
does not consume personal-library quota or change saved presets.

Existing personal authored studies still take precedence for their source ID.
The library counter distinguishes **1,283 artistic** studies from **personal**
overrides; personal work remains **Authored · unreviewed**. Removing a personal
override returns to the artistic default. The details dialog's **Open generated
approximation** retains the previous 203-scene fallback, and its selection can
be reloaded with `variant=generated`.

Orbit, camera views, Focus, editing, saving, source links and PNG/SVG/JSON exports
work as before. Editable exports preserve source identity and an `artistic` tag
and caption. They do not gain a verification badge. Diagnostic captions are not
inserted into the natural-language command field.

The original source index, approximation pack, stock presets, models, solver,
worker and renderer remain unchanged. To reproduce the content offline from
the committed neutral metadata and model choices:

```sh
node scripts/build-artistic-studies.mjs --check
```

## Limits

Distinct and renderable does not mean anatomically exact or physically stable.
The pose checker remains visible; coarse support and self-collision reports
are diagnostics, not certification. Ground separation uses posed body proxies,
not precise garment/skin contact or force simulation. The offline coarse check
flags support gaps over 40 mm in 87 compositions; the worst reported gap is
about 51.5 mm. These warnings are not suppressed or relabeled as verified poses.
No original reference
images, cloud service, new dependency or hosted deployment is introduced.
