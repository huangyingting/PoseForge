# Interactive 3D reference posture previews

## Scope

Every one of the 1,283 indexed records must open a real, rotatable clothed 3D
posture study. No source images are copied or requested. These are approximate
individual posture studies, not reconstructions of sexual activity: participants
are displayed separately, and relationship/contact descriptions are omitted.
The source contains categorical posture/limb descriptions, not measured joint
coordinates. Preserve that distinction in cards, the stage, notes and exports.

## Simple runtime model

Treat the reference viewer as a pose player: reusable clothed models plus stored
joint angles and figure placements. Interpret the source annotations once in the
offline importer, then load a compact scene record when a reference is selected.
The existing renderer and controls are shared by every record; exact duplicate
scenes share one payload. This simplifies delivery and browsing, but cannot
recover exact geometry or omitted relationships from categorical labels.

## Pipeline

- Extend the deterministic offline importer with canonical individual postures,
  limb/trunk hints and body choices. Never truncate records with three figures.
- Use the existing pose engine to create individual rigs, capture portable fixed
  placements/joints, and arrange the independent studies with measured separation.
  Clamp through the existing joint schema; retain approximation/deferred-data notes.
- Deduplicate identical generated geometry. Ship the metadata index separately
  from a lazily loaded, size/hash/schema-checked preview pack. No sibling checkout
  is required to view the committed previews.
- Keep stable source IDs/hashes and source annotation grouping. Report the number
  of distinct generated scenes separately from the 1,283 records.

## Viewer integration

- Clicking a reference card loads its 3D preview into the existing studio.
  Source/provenance details move to a separate accessible button. Preserve the
  compact library, filters, grouping, paging and late-response cancellation.
- Label references and the stage **Approximate 3D**, never Verified. Pose notes
  explain separate participants, assumed floor support, missing/defaulted details
  and any measured geometry problems. Existing stock verification is unchanged.
- Reuse orbit, zoom, camera views, Focus, editing, capture, save and PNG/SVG/JSON
  export. A saved copy remains a personal, unverified study with its source link.
- Support `?reference=<source-id>` links and reload. Failed downloads leave the
  prior scene intact; stale responses must not replace a newer selection/edit.

## Acceptance

1. Reconcile every source ID and all 2,567 participants, including the 12 solo
   and 13 three-person records. Validate every generated scene and deduplicated
   mapping; regenerate artifacts byte-for-byte.
2. Check every distinct generated scene for finite rig/mesh data and separated
   figure bounds. Report proxy/support limitations rather than claiming universal
   physical validity or silently falling back to a standing figure.
3. Browser-render the distinct preview geometries in bounded batches; verify
   source selection, camera changes, source details, save/export/reload, direct
   links, rapid switches, download failure/retry and mobile controls. No original
   image requests are permitted.
4. Add unit coverage for generation, pack validation, lookup, notes, deduplication
   and race/failure behavior. Run relevant existing regressions and build/audit
   gates. Keep measurement evidence separate from renderability claims.
5. Document exact coverage and limitations; deliver the authorized iteration to
   private main with synchronization verification. No hosted deployment.
