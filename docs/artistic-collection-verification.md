# Artistic collection verification

**Delivered:** 1,283 distinct, ready-to-view artistic 3D compositions, retaining
all 2,567 participants. These are original clothed studies with separate figures,
not source reconstructions. The collection is included in the application and
requires no user authoring, import or personal-library initialization.

**Final checks:** 58/58 targeted unit tests, 42/42 application browser scenarios,
and a **1,283/1,283 direct-render inventory** passed. Production builds,
byte-for-byte content regeneration, formatting and whitespace checks passed.
The dependency audit reported zero vulnerabilities.

The [audit ledger](audit-artistic-collection/results.json) records source/test
hashes, the content manifest, every browser case, rendering scope, uniqueness
measurements and limitations. The [per-scene evidence](audit-artistic-collection/rendered-scenes.json)
records every composition. Inspected screenshots show the
[desktop collection](audit-artistic-collection/artistic-desktop.png) and
[mobile three-person preview](audit-artistic-collection/artistic-mobile.png).

## Content and uniqueness

All source IDs reconcile exactly to the committed neutral index: 12 solo,
1,258 two-person and 13 three-person records. The delivered pack is 4,359,190
bytes and has SHA-256
`4640214cf625579cd0eadd06fb03ea40e90d45a6d31ad8e1633a0d75d494d4db`.

There are 141 body/gesture motifs, or 403 motifs when gaze is included. These
combine into 1,283 distinct whole compositions; this is not a claim of 1,283
hand-sculpted base poses. The uniqueness gate ignores head/neck angles, actor
order, body/model choice, placement, camera, titles and colours. It checks
10-degree-quantized limb/torso joint signatures and rejects duplicates.

The nearest equal-participant-count pair differs by at least **25 degrees** in
a body joint after optimal actor matching. The comparison minimizes the largest
absolute angle difference across possible actor assignments. It does not count
a different gaze as a different composition and does not claim perceptual or
source-image equivalence.

## Rendering coverage

The direct-render inventory uses the existing solver, scanned model templates,
clothing/skinning pipeline and Three.js renderer for every composition. All
2,567 actors have finite mesh positions/normals, top and shorts parts, real
scanned geometry and visible coloured pixels. Every actor has more than 10,000
triangles. The lowest sampled coloured-pixel count is 45 in the 64 × 64 probe.
The content hash was unchanged throughout the inventory; no browser page errors
occurred.

This inventory renders at **256 × 192**, with shadows disabled, without the
application worker's surface-refinement pass or final occlusion. It is not a
full-worker traversal of all 1,283 compositions.

Separately, **10 representative compositions** cover every one of the eight
whole-body bases, twenty gestures, three body types and three participant
counts through the full application worker. Their final joint values and
placements match the baked data, and the returned scanned/clothed meshes are
finite. Full application screenshots use the normal viewport and shadows.

## Application behavior

The 42 browser scenarios cover automatic artistic selection in a fresh library,
source URLs, metadata grouping and bounded pages, mobile and desktop controls,
accessibility, camera/zoom, PNG/SVG/JSON export, no source-image requests in the
reference flows, legacy approximations, personal overrides, save/edit/reload,
storage failures, retry and late-request cancellation. Installing the built-in
collection does not create personal presets; the fresh-library counter reads
**1,283 artistic · 0 personal**.

The original source index and 203-scene approximation pack remain unchanged.
Stock definitions, model assets, solver, worker and renderer are also unchanged.
The complete historical unit suite was not rerun; the 58 targeted units and
42 browser scenarios are this iteration's application evidence.

## Refinements and limits

An early draft counted some head-only variations. The final builder excludes
gaze from composition identity and its minimum-distance test. The earlier
draft runs were stopped and are not counted as final evidence. Another check
found the legacy solver could infer partner support when a recumbent figure
was listed first; artistic compositions now list upright figures first, without
changing the solver or counting ordering as new geometry.

All baked rigs remain fixed, finite, clothed and separated by at least 0.599 m
between coarse world-X bounds. All participants have surface-support rather
than partner-support classification. Nevertheless, **87 compositions** exceed
the coarse 40 mm support-gap threshold. The maximum reported support gap is
**0.051547 m**; maximum proxy penetration is **0.000010263 m**. These are body-proxy
measurements, not precise garment/skin contact or force simulation. Pose warnings
remain visible. Distinct/renderable does not certify anatomy, physical stability
or fidelity to the original source.

No original reference imagery, new dependency, cloud service or hosted deployment
is added. Physical-device and assistive-technology certification are not claimed.
