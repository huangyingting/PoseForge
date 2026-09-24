# Author a local position override

The unified position catalog supports one independent saved 3D override for
every one of the 1,283 source IDs. A fresh library starts with **0 local
overrides**. The artistic compositions and 203 shared generated
approximations remain optional fallbacks. Editing/import tools are optional;
see the [artistic collection](artistic-collection.md) for the bundled content.

## Edit and save

1. Open **Positions**, search by position name or source ID, and select a card.
2. Choose **Edit posture**. Use the existing figure controls, joint sliders and
   Placement controls. Keep all participants, with top and shorts, separate on
   a neutral floor. No partner contacts are accepted in this workflow.
3. Wait for the preview to finish, then choose **Save position override**. On
   mobile, return to **Studio** to access this action. The save captures the
   completed joint angles and placements; name it and choose **Save override**.
4. If an override already exists, explicitly confirm replacement. It
   updates only this source ID; other references, even matching annotations,
   keep their own saved data.

Cards and `?reference=img-0001` links prefer the local override. The
**Authored · unreviewed** filter finds them without creating duplicate position
cards.
Authored is a storage/workflow label, not a claim of physical quality, source
fidelity, distinct geometry, or independent review. Pose checks remain visible.

The information button offers **Open generated approximation**, without deleting
the authored version. That choice survives reload via `&preview=generated`.
Opening the main position card again selects the authored version. To remove an
override, open it, choose **Save preset → Delete preset**, and confirm.
Its built-in artistic view returns, and its generated fallback remains available.
Deletion removes the local saved
study; recovery requires an exported backup or resaving the still-open scene.

## Bulk import and export

Choose **Library tools** at the bottom of the library. This single sheet handles
ordinary saved-preset import/export and source-linked position overrides.
**Export position overrides** downloads active overrides with their source IDs,
annotation fingerprints, participant data, joint angles and placements.

**Import position overrides (JSON)** accepts the existing `poseforge.catalog`
format, version 1. An exported editable preset with a source association can
also be imported here. Each preset needs `source.dataset = "SexPoses"`, the
exact `source.recordId`, and the matching `source.annotationHash` from the
current catalog. Export a reference's editable preset to obtain that structure;
do not invent annotation hashes. The generated preset already has complete
fixed joints/placements; for other studies use **Capture current layout** in
Figures before exporting.

The whole file is validated before **Import overrides** becomes available. Review
the new/existing counts first. Existing position overrides are kept by default;
the replacement checkbox explicitly opts in to updating them. A failed record
or storage transaction saves none of the batch. Duplicate source IDs, unknown
or stale sources and incorrect participant counts are errors, not omissions.

Every accepted study must have complete fixed joints and placements, top and
shorts, no partner contacts, a floor, and at least 0.25 m between coarse figure
bounds along world X. Separation is checked using posed body proxies without
intimate anatomy, not a precise rendered-mesh collision test. This does not
certify self-collision, support, balance, clothing fit or source accuracy.
Parser-command text is cleared while descriptive preset metadata is retained.

The existing browser-local library limit remains **5,000 presets / 32 MB**.
The importer commits the batch in one transaction. Cross-tab conflicts and
quota failures leave the previous library intact; export a backup and reload
after a cross-tab conflict. No cloud storage or server upload is added.

One active override per source uses `user.reference.sexposes.<source-id>`
internally for backward-compatible storage. Ordinary saved copies allocate
personal IDs and do not change active source bindings. Use **Library tools →
Import position overrides** to restore bindings from a portable backup.
