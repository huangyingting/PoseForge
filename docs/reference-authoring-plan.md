# Per-reference posture authoring

## Contract

The 1,283 source records remain available as generated approximations. This
iteration adds a way to replace any record's default preview with a locally
authored, clothed individual posture study. It does not create missing measured
poses or reconstruct sexual interactions. An authored study is **unreviewed**,
not proof of uniqueness, source accuracy or physical validity.

## Small workflow

1. Open a reference, choose **Edit posture**, and use the existing figure editor.
2. **Save reference study** captures the completed joint angles and placements.
   Confirm replacement if this reference already has an authored study.
3. Reference cards and `?reference=` links prefer that saved study. The source
   details dialog can still open the generated approximation without deleting
   the authored version. Removing the saved study restores the default.
4. **Reference studies** opens bulk import/export and the authored coverage count.
   Imports use the existing portable catalog JSON format with source IDs and
   annotation hashes. Preview the count before applying; keep existing studies
   by default, with explicit opt-in to replacement.

## Persistence and validation

- Reuse the existing transactional library and its 5,000-preset / 32 MB limits.
  A reserved `user.reference.sexposes.<source-id>` ID gives each record one
  independent active study. Ordinary saved copies and imports do not acquire
  this binding automatically; the reference import workflow is explicit.
- Validate the whole pack before committing once. Reject duplicate source IDs,
  unknown or stale sources, wrong participant counts and malformed scenes.
- Require fixed joints/placements, top and shorts, a neutral floor, no partner
  contacts, and at least 0.25 m separation between coarse figure bounds along X.
  These checks enforce separate individual studies, not anatomical certification.
- Saving captures the currently completed pose, not a pending worker result.
  Failed validation/storage leaves prior studies intact. Stale preview requests
  cannot overwrite a newer save or edit. No model or solver change is planned.
- Authored coverage counts unique valid source bindings, not generated records.
  Display **Authored · unreviewed** and retain source identity through export.
  All data remains in this browser; export JSON for backup or transfer.

## Verification

Test complete 1,283-entry bulk import/export and source reconciliation in Node;
validate conflicts, duplicates, stale hashes, unsafe scenes, quota failures and
transaction rollback. Browser-test editing, capture/save/update, reload and
reference links, generated fallback, import confirmation/atomic failure,
export round trips, keyboard/mobile reachability and automated accessibility.
Repeat relevant existing reference, library and compact-workspace regressions.
Build and audit dependencies; record evidence and limitations before delivering
the authorized iteration to private `main`. No hosted deployment.
