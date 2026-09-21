import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  NAMED_PRESETS,
  checkScene,
  parseCatalog,
  serializeCatalog,
} from "../src/core/catalog.js";
import { ARCHETYPES } from "../src/nlp/archetypes.js";
import { parseDescription } from "../src/nlp/parser.js";
import { applyPresetLayout } from "../src/nlp/presetLayouts.js";
import { solveScene } from "../src/core/solver.js";
import { solvedPreview } from "../src/core/posePreview.js";
import { resolveSurface } from "../src/core/poseLibrary.js";
import { rootFromPlacement, captureSolvedPose } from "../src/core/placement.js";
import {
  buildHumanTemplate,
  featureRelief,
  skinHumanMesh,
} from "../src/core/humanMesh.js";
import { withGarments } from "../src/core/garments.js";
import { withHair } from "../src/core/hair.js";
import {
  refineSurfaceContacts,
  SURFACE_CONTACT_TOLERANCE,
} from "../src/core/surfaceContacts.js";

const calibrated = ARCHETYPES.filter((entry) => entry.layout);
const portable = (value) => JSON.parse(JSON.stringify(value));
const draft = (definition) => ({
  actors: structuredClone(definition.actors),
  support: { surface: definition.surface },
  relationship: { arrangement: definition.arrangement },
  contacts: structuredClone(definition.contacts ?? []),
});
const actorGeometry = (scene) =>
  scene.actors.map(({ id, label, ...actor }) => actor);

for (const definition of calibrated) {
  const preset = NAMED_PRESETS.find(
    (entry) => entry.id === `builtin.named.${definition.id}`,
  );

  test(`${definition.id}: all calibrated aliases and the catalog share the complete portable pose`, () => {
    for (const phrase of definition.phrases) {
      const parsed = parseDescription(phrase);
      assert.deepEqual(parsed.warnings, [], phrase);
      const scene = checkScene(portable(parsed.scene));
      assert.deepEqual(
        actorGeometry(scene),
        actorGeometry(preset.scene),
        phrase,
      );
      for (const key of ["contacts", "relationship", "support", "camera"])
        assert.deepEqual(scene[key], preset.scene[key], `${phrase}: ${key}`);
      assert.ok(
        parsed.interpretation.some(
          (item) => item.field === "layout" && item.value === definition.id,
        ),
      );
    }
    assert.deepEqual(parseCatalog(serializeCatalog([preset])), [preset]);
  });

  test(`${definition.id}: layout application is pure, preserves appearance and gives explicit cameras precedence`, () => {
    const source = draft(definition);
    Object.assign(source.actors[0], {
      id: "custom-id",
      label: "Custom label",
      skinTone: "#9d7152",
      outfit: "red",
      wearing: ["shorts", "top"],
    });
    source.camera = { view: "front" };
    const before = structuredClone(source),
      recipe = structuredClone(definition.layout);
    const result = applyPresetLayout(source, definition);
    assert.equal(result.applied, true);
    assert.deepEqual(source, before);
    assert.deepEqual(definition.layout, recipe);
    assert.deepEqual(result.scene.camera, source.camera);
    for (const key of ["id", "label", "skinTone", "outfit", "wearing"])
      assert.deepEqual(result.scene.actors[0][key], source.actors[0][key]);
    result.scene.actors[0].placement.position[0] = 9;
    result.scene.actors[0].joints.neck.flexion = 12;
    result.scene.camera.view = "side";
    assert.deepEqual(definition.layout, recipe);
    assert.deepEqual(source, before);
    assert.equal(
      applyPresetLayout(draft(definition), definition).scene.camera.view,
      definition.layout.camera.view,
    );
  });

  test(`${definition.id}: supported surfaces use their own fitted actors or the shared plane translation`, () => {
    for (const surface of definition.layout.surfaces) {
      const source = draft(definition);
      source.support.surface = surface;
      const result = applyPresetLayout(source, definition);
      assert.equal(result.applied, true);
      const reference =
        definition.layout.surfaceVariants?.[surface] ?? definition.layout;
      const shifted = structuredClone(reference.actors);
      shifted.forEach(
        (actor) =>
          (actor.placement.position[1] +=
            resolveSurface(surface).height - reference.referenceHeight),
      );
      assert.deepEqual(result.scene.actors, shifted);
      assert.deepEqual(
        result.scene.camera,
        reference.camera ?? definition.layout.camera,
      );
    }
  });

  test(`${definition.id}: requested variations never inherit or overwrite a stock fixed layout`, () => {
    const variations = [
      (scene) => scene.actors.pop(),
      (scene) =>
        (scene.actors[0].bodyType =
          definition.actors[0].bodyType === "male" ? "female" : "male"),
      (scene) => (scene.actors[0].stature = 1.85),
      (scene) => (scene.actors[0].build = 1.1),
      (scene) => (scene.actors[0].bust = 0.8),
      (scene) => (scene.actors[0].posture = "supine"),
      (scene) => (scene.actors[0].wearing = ["top"]),
      (scene) => (scene.actors[0].wearing = []),
      (scene) => (scene.actors[0].jointMode = "fixed"),
      (scene) => (scene.actors[0].joints = { elbow_l: { flexion: 45 } }),
      (scene) =>
        (scene.actors[0].placement = {
          position: [0, 1, 0],
          rotation: [0, 0, 0],
        }),
      ...["arms", "legs", "trunk", "hands", "feet", "hair", "mobility"].map(
        (key) => (scene) =>
          (scene.actors[0][key] = key === "mobility" ? 0 : "explicit"),
      ),
      (scene) => (scene.relationship.arrangement = "side_by_side"),
      (scene) => (scene.relationship.yaw = (definition.layout.yaw + 180) % 360),
      (scene) => (scene.relationship.contactMode = "custom"),
      (scene) =>
        scene.contacts.push({
          from: "hand.l",
          to: "hand.r",
          fromActor: 0,
          toActor: 1,
        }),
      (scene) => (scene.support.surface = "sofa"),
    ];
    for (const change of variations) {
      const scene = draft(definition);
      change(scene);
      const before = structuredClone(scene),
        result = applyPresetLayout(scene, definition);
      assert.equal(result.applied, false, String(change));
      assert.ok(result.reason);
      assert.equal(result.scene, scene);
      assert.deepEqual(scene, before);
    }
  });

  test(`${definition.id}: literal surface calibration and taller or away fallback retain the requested settings`, () => {
    const phrase = definition.phrases[0];
    for (const surface of definition.layout.surfaces) {
      const parsed = parseDescription(`${phrase} on the ${surface}`);
      assert.deepEqual(parsed.warnings, []);
      assert.equal(parsed.scene.support.surface, surface);
      assert.equal(
        parsed.scene.camera.view,
        definition.layout.surfaceVariants?.[surface]?.camera?.view ??
          definition.layout.camera.view,
      );
      assert.ok(parsed.scene.actors.every((actor) => actor.placement));
    }
    const male = definition.actors.findIndex(
      (actor) => actor.bodyType === "male",
    );
    for (const [text, check] of [
      [
        `${phrase}, he is tall`,
        (scene) => assert.equal(scene.actors[male].stature, 1.85),
      ],
      [
        `${phrase}, facing away`,
        (scene) =>
          assert.equal(
            scene.relationship.yaw,
            (definition.layout.yaw + 180) % 360,
          ),
      ],
    ]) {
      const parsed = parseDescription(text);
      assert.deepEqual(parsed.warnings, []);
      assert.ok(
        parsed.scene.actors.every(
          (actor) => !actor.placement && actor.jointMode === "guided",
        ),
      );
      assert.ok(
        parsed.interpretation.some(
          (item) => item.field === "layout" && item.value === "automatic",
        ),
      );
      check(parsed.scene);
    }
  });
}

test("definitions without a calibrated recipe retain automatic placement", () => {
  for (const entry of ARCHETYPES.filter((entry) => !entry.layout)) {
    assert.ok(
      parseDescription(entry.phrases[0]).scene.actors.every(
        (actor) => !actor.placement,
      ),
      entry.id,
    );
    const source = draft(calibrated[0]),
      result = applyPresetLayout(source, entry);
    assert.equal(result.applied, false);
    assert.equal(result.scene, source);
  }
});

const templates = new Map();
function dressed(actor) {
  const spec = actor.spec;
  const key = JSON.stringify([
    spec.bodyType,
    spec.build,
    spec.bust,
    spec.wearing,
    spec.outfit,
    spec.hair,
  ]);
  if (!templates.has(key)) {
    const body = featureRelief(
      buildHumanTemplate(
        readFileSync(
          new URL(
            `../assets/models/realistic-${spec.bodyType}.glb`,
            import.meta.url,
          ),
        ),
      ),
      spec,
    );
    templates.set(
      key,
      withHair(
        withGarments(body, {
          bodyType: spec.bodyType,
          wearing: spec.wearing,
          colour: spec.outfit,
        }),
        { bodyType: spec.bodyType, style: spec.hair },
      ),
    );
  }
  return templates.get(key);
}

const expectedContacts = {
  side_by_side_facing: [
    ["chest", "chest"],
    ["pelvis", "pelvis"],
  ],
  spooning: [
    ["chest", "upperBack"],
    ["pelvis", "buttocks"],
    ["hand", "waist"],
  ],
  chair_straddle: [
    ["pelvis", "lap"],
    ["hand", "shoulder"],
    ["hand", "shoulder"],
  ],
  lotus: [
    ["pelvis", "lap"],
    ["hand", "shoulder"],
    ["hand", "shoulder"],
    ["hand", "upperBack"],
    ["hand", "upperBack"],
  ],
};

for (const definition of calibrated)
  for (const surface of definition.layout.surfaces)
    test(`${definition.id}: the clothed ${surface} layout has close contacts, clear figures and the expected authoring policy`, () => {
      const scene = checkScene(
        portable(
          parseDescription(`${definition.phrases[0]} on the ${surface}`).scene,
        ),
      );
      const solved = solveScene(scene),
        bodies = solved.actors.map(dressed);
      assert.deepEqual(
        solvedPreview(solved).issues,
        [],
        "stock layout must also pass the base-model gate",
      );
      const poses = structuredClone(solved.actors.map((actor) => actor.pose));
      refineSurfaceContacts(solved, bodies);
      assert.deepEqual(solvedPreview(solved).issues, []);
      const guided = scene.actors.some(
        (actor) => actor.placement?.mode === "guided",
      );
      if (guided) {
        assert.equal(solved.quality.surfaceRefinement.guidedPoseSteps, 1);
        assert.equal(solved.quality.surfaceRefinement.steps, 1);
        solved.actors.forEach((actor, i) => {
          assert.deepEqual(
            actor.pose.root,
            rootFromPlacement(scene.actors[i].placement),
          );
          for (const [bone, angles] of Object.entries(scene.actors[i].joints))
            for (const [channel, value] of Object.entries(angles))
              assert.equal(actor.pose.joints[bone][channel], value);
        });
      } else {
        assert.deepEqual(
          solved.actors.map((actor) => actor.pose),
          poses,
        );
        assert.equal(solved.quality.surfaceRefinement.steps, 0);
      }
      assert.equal(solved.quality.unmetContacts, 0);
      assert.deepEqual(
        solved.quality.contactDetail.map(({ from, to }) => [from, to]),
        expectedContacts[definition.id],
      );
      for (const contact of solved.quality.contactDetail) {
        assert.equal(contact.basis, "rendered");
        assert.equal(contact.intersects, false);
        assert.ok(
          contact.surfaceGap >= 0 &&
            contact.surfaceGap <= SURFACE_CONTACT_TOLERANCE,
        );
      }
      assert.equal(solved.quality.figureSurfaces.length, 1);
      assert.ok(
        solved.quality.figureSurfaces.every(
          (pair) => pair.intersects === false,
        ),
      );
      for (const key of [
        "maxDepth",
        "maxSelfDepth",
        "maxBodyDepth",
        "propPenetration",
      ])
        assert.equal(solved.quality[key], 0, key);
      const partnerSupported = definition.arrangement === "straddle_lap";
      assert.deepEqual(
        solved.actors.map((actor) => actor.supportBasis),
        partnerSupported ? ["surface", "partner"] : ["surface", "surface"],
      );
      if (!partnerSupported)
        assert.ok(solved.quality.balance.every((balance) => balance.supported));
      else if (solved.props.length) {
        assert.ok(solved.quality.proxyPropPenetration > 0.05);
        assert.ok(solved.quality.verifiedPropContacts > 0);
      }
      assert.equal(solved.quality.supportSurfaces.length, solved.actors.length);
      for (const support of solved.quality.supportSurfaces) {
        if (support.basis === "partner") {
          assert.equal(support.gap, null);
          assert.deepEqual(support.supports, []);
          continue;
        }
        assert.equal(support.basis, "rendered");
        assert.equal(support.unavailable, 0);
        assert.ok(
          support.supports.every(
            (part) =>
              part.measurement.gap <= 0.02 &&
              part.measurement.penetration === 0,
          ),
        );
      }
      solved.actors.forEach((actor, i) => {
        if (actor.supportBasis === "partner") {
          assert.equal(actor.supportMeasurement, null);
          assert.equal(actor.bodySupportResidual, null);
          assert.equal(actor.seatResidual, null);
          assert.equal(solved.quality.renderedBalance[i], null);
        } else {
          assert.equal(actor.supportMeasurement, "rendered");
          assert.ok(solved.quality.renderedBalance[i]?.supported);
          if (partnerSupported) {
            assert.ok(actor.bodySupportResidual > 0.05);
            assert.ok(actor.seatResidual <= 0.004);
          } else {
            assert.ok(actor.bodySupportResidual <= 0.02);
            assert.ok(actor.seatResidual <= 0.02);
          }
        }
        let minY = Infinity;
        for (const part of skinHumanMesh(
          bodies[i],
          actor.skeleton,
          actor.evaluated,
          undefined,
          actor.hands,
          actor.hang,
        ))
          for (const index of part.indices)
            minY = Math.min(minY, part.positions[index * 3 + 1]);
        assert.ok(minY >= -1e-7);
        if (actor.supportBasis === "surface") {
          const plane = Math.min(
            ...solved.quality.supportSurfaces[i].supports.map(
              (part) => part.measurement.plane,
            ),
          );
          assert.ok(
            Math.abs(minY - plane) <= 0.004,
            `${surface} lowest surface: ${minY}`,
          );
        }
      });
    });

test("a chair layout without scanned geometry keeps the coarse result and unavailable checks", () => {
  const definition = ARCHETYPES.find((entry) => entry.id === "chair_straddle");
  const scene = checkScene(
    portable(parseDescription(definition.phrases[0]).scene),
  );
  const solved = solveScene(scene),
    poses = structuredClone(solved.actors.map((actor) => actor.pose));
  refineSurfaceContacts(solved, [null, null]);
  assert.deepEqual(
    solved.actors.map((actor) => actor.pose),
    poses,
  );
  assert.ok(solved.quality.propPenetration <= 0.022);
  assert.equal(solved.quality.verifiedPropContacts, 0);
  assert.equal(solved.actors[0].supportMeasurement, "body-model");
  assert.ok(solvedPreview(solved).issues.includes("Support check unavailable"));
  assert.ok(
    solvedPreview(solved).issues.includes("Furniture check unavailable"),
  );
  assert.ok(solvedPreview(solved).issues.includes("Surface check unavailable"));
});

test("the seated embrace captures and reloads all five contacts on floor and bed", () => {
  for (const surface of ["floor", "bed"]) {
    const scene = checkScene(
      portable(parseDescription(`seated embrace on the ${surface}`).scene),
    );
    const solved = solveScene(scene),
      bodies = solved.actors.map(dressed);
    assert.deepEqual(solvedPreview(solved).issues, []);
    refineSurfaceContacts(solved, bodies);
    const positions = solved.actors.map((actor) =>
      actor.evaluated.positions.map((position) => position.slice()),
    );
    scene.actors.forEach((actor, i) =>
      Object.assign(actor, captureSolvedPose(solved.actors[i])),
    );
    assert.ok(
      scene.actors.every(
        (actor) =>
          actor.jointMode === "fixed" && actor.placement.mode !== "guided",
      ),
    );
    const restored = solveScene(checkScene(portable(scene)));
    refineSurfaceContacts(restored, bodies);
    assert.deepEqual(solvedPreview(restored).issues, []);
    assert.equal(restored.quality.surfaceRefinement.guidedPoseSteps, 0);
    assert.equal(restored.quality.contactDetail.length, 5);
    assert.ok(
      restored.quality.contactDetail.every(
        (contact) =>
          contact.basis === "rendered" &&
          !contact.intersects &&
          contact.surfaceGap <= SURFACE_CONTACT_TOLERANCE,
      ),
    );
    restored.actors.forEach((actor, i) =>
      actor.evaluated.positions.forEach((position, j) =>
        position.forEach((value, k) =>
          assert.ok(Math.abs(value - positions[i][j][k]) < 1e-7),
        ),
      ),
    );
  }
});

test("missing geometry cannot certify the seated embrace or replace its coarse result", () => {
  for (const surface of ["floor", "bed"]) {
    const solved = solveScene(
      checkScene(
        portable(parseDescription(`seated embrace on the ${surface}`).scene),
      ),
    );
    assert.deepEqual(solvedPreview(solved).issues, []);
    const before = structuredClone(solved.actors.map((actor) => actor.pose));
    refineSurfaceContacts(solved, [null, null]);
    assert.deepEqual(
      solved.actors.map((actor) => actor.pose),
      before,
    );
    assert.equal(solved.actors[0].supportMeasurement, "body-model");
    assert.equal(solved.actors[1].supportBasis, "partner");
    assert.equal(solved.actors[1].seatResidual, null);
    assert.ok(
      solvedPreview(solved).issues.includes("Surface check unavailable"),
    );
    assert.ok(
      solvedPreview(solved).issues.includes("Support check unavailable"),
    );
    assert.ok(
      !solved.quality.adjustments.some((note) =>
        note.includes("guided starting pose"),
      ),
    );
  }
});
