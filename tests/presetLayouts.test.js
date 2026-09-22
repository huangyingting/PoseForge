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
import { solveScene, measureBodySupportResidual } from "../src/core/solver.js";
import { solvedPreview } from "../src/core/posePreview.js";
import { resolveArrangement, resolveSurface } from "../src/core/poseLibrary.js";
import { rootFromPlacement, captureSolvedPose } from "../src/core/placement.js";
import {
  buildHumanTemplate,
  featureRelief,
  skinHumanMesh,
  bindCorrections,
  poseJoints,
} from "../src/core/humanMesh.js";
import { v3cross, v3dot, v3normalize, v3sub } from "../src/core/math.js";
import { withGarments } from "../src/core/garments.js";
import { withHair } from "../src/core/hair.js";
import {
  refineSurfaceContacts,
  createSurfaceContactQuery,
  SURFACE_CONTACT_TOLERANCE,
} from "../src/core/surfaceContacts.js";

const calibrated = ARCHETYPES.filter((entry) => entry.layout);
const portable = (value) => JSON.parse(JSON.stringify(value));
const draft = (definition) => ({
  actors: structuredClone(definition.actors),
  support: { surface: definition.surface },
  relationship: {
    arrangement: definition.arrangement,
    ...(definition.facing
      ? {
          yaw:
            (resolveArrangement(definition.arrangement).yaw +
              (definition.facing === "away" ? 180 : 0)) %
            360,
        }
      : definition.yaw != null
        ? { yaw: definition.yaw }
        : {}),
  },
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
      (scene) =>
        (scene.actors[0].posture =
          definition.actors[0].posture === "supine" ? "prone" : "supine"),
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
        `${phrase}, facing ${definition.facing === "away" ? "him" : "away"}`,
        (scene) =>
          assert.equal(
            scene.relationship.yaw ??
              resolveArrangement(scene.relationship.arrangement).yaw,
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
  missionary: [["pelvis", "pelvis"]],
  cowgirl: [
    ["pelvis", "pelvis"],
    ["hand", "chest"],
    ["hand", "chest"],
    ["hand", "knee"],
    ["hand", "knee"],
  ],
  reverse_cowgirl: [
    ["pelvis", "pelvis"],
    ["hand", "chest"],
    ["hand", "chest"],
    ["hand", "knee"],
    ["hand", "knee"],
  ],
  doggy_style: [
    ["pelvis", "buttocks"],
    ["hand", "hip"],
    ["hand", "hip"],
  ],
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
  standing_carry: [
    ["chest", "chest"],
    ["buttocks", "hand"],
    ["buttocks", "hand"],
    ["hand", "shoulder"],
    ["hand", "shoulder"],
  ],
  bent_over_table: [
    ["pelvis", "buttocks"],
    ["hand", "hip"],
    ["hand", "hip"],
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
      for (const actor of solved.actors)
        if (actor.supportBasis === "surface")
          assert.ok(
            measureBodySupportResidual(actor, solved.surface) <= 0.02,
            "coarse default supports must pass before rendered adoption",
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
      const partnerSupported =
        resolveArrangement(definition.arrangement).mounted === true;
      const primarySeated = ["seated", "seated_reclined", "reclined"].includes(
        solved.actors[0].spec.posture,
      );
      assert.deepEqual(
        solved.actors.map((actor) => actor.supportBasis),
        partnerSupported ? ["surface", "partner"] : ["surface", "surface"],
      );
      if (!partnerSupported)
        assert.ok(solved.quality.balance.every((balance) => balance.supported));
      else if (primarySeated && solved.props.length) {
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
            if (primarySeated) assert.ok(actor.bodySupportResidual > 0.05);
            else if (actor.spec.placement?.mode === "guided")
              assert.equal(
                actor.bodySupportResidual,
                measureBodySupportResidual(actor, solved.surface),
              );
            else assert.ok(actor.bodySupportResidual <= 0.02);
            assert.ok(actor.seatResidual <= 0.004);
          } else {
            if (actor.spec.placement?.mode === "guided") {
              // A rendered guide may disagree with the coarse approximation.
              // Its coarse DEFAULT still passes above; retain the final raw
              // measurement without mistaking it for the rendered support.
              assert.equal(
                actor.bodySupportResidual,
                measureBodySupportResidual(actor, solved.surface),
              );
            } else assert.ok(actor.bodySupportResidual <= 0.02);
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

for (const [phrase, yaw] of [
  ["cowgirl", 0],
  ["reverse cowgirl", 180],
]) {
  test(`${phrase}: five explicit contacts, palm-up knee supports, grounded feet and actual facing survive both surfaces`, () => {
    for (const surface of ["floor", "bed"]) {
      const scene = checkScene(
        portable(parseDescription(`${phrase} on the ${surface}`).scene),
      );
      assert.deepEqual(
        scene.actors.map((actor) => [actor.posture, actor.bodyType]),
        [
          ["supine", "male"],
          ["kneeling_straddle", "female"],
        ],
      );
      assert.ok(
        scene.actors.every(
          (actor) =>
            actor.jointMode === "guided" && actor.placement.mode === "guided",
        ),
      );
      assert.equal(scene.relationship.arrangement, "straddle_supine");
      assert.equal(scene.relationship.yaw ?? 0, yaw);
      const solved = solveScene(scene),
        bodies = solved.actors.map(dressed);
      assert.deepEqual(solvedPreview(solved).issues, []);
      refineSurfaceContacts(solved, bodies);
      assert.deepEqual(solvedPreview(solved).issues, []);
      assert.deepEqual(
        solved.contacts.map(
          ({
            fromActor,
            toActor,
            from,
            to,
            fromSide,
            toSide,
            type,
            strength,
          }) => [
            fromActor,
            toActor,
            from,
            to,
            fromSide ?? null,
            toSide ?? null,
            type,
            strength,
          ],
        ),
        [
          [1, 0, "pelvis", "pelvis", null, null, "support", 1],
          [1, 0, "hand", "chest", "l", null, "rest", 0.5],
          [1, 0, "hand", "chest", "r", null, "rest", 0.5],
          [0, 1, "hand", "knee", "l", yaw === 0 ? "r" : "l", "support", 0.7],
          [0, 1, "hand", "knee", "r", yaw === 0 ? "l" : "r", "support", 0.7],
        ],
      );
      assert.deepEqual(
        solved.quality.contactDetail.map((c) => c.source),
        ["arrangement", "arrangement", "arrangement", "custom", "custom"],
      );
      assert.ok(
        solved.quality.contactDetail.every(
          (c) =>
            c.basis === "rendered" &&
            !c.intersects &&
            c.surfaceGap >= 0.001 &&
            c.surfaceGap <= 0.004,
        ),
      );
      assert.deepEqual(
        solved.actors.map((a) => a.supportBasis),
        ["surface", "partner"],
      );
      assert.equal(solved.actors[1].seatResidual, null);
      assert.equal(solved.actors[1].bodySupportResidual, null);
      assert.deepEqual(
        solved.quality.supportSurfaces[0].supports.map((s) => s.landmark),
        ["upperBack", "buttocks", "head"],
      );
      assert.ok(
        solved.quality.supportSurfaces[0].supports.every(
          ({ measurement: m }) =>
            m.withinFootprint && m.penetration === 0 && m.gap <= 0.004,
        ),
      );
      assert.ok(
        solved.actors[0].bodySupportResidual > 0.06 &&
          solved.actors[0].bodySupportResidual < 0.063,
      );
      assert.equal(
        solved.actors[0].bodySupportResidual,
        measureBodySupportResidual(solved.actors[0], solved.surface),
      );
      const query = createSurfaceContactQuery(solved.actors, bodies);
      for (const side of ["l", "r"]) {
        const foot = query.support(
          1,
          { landmark: "foot", side },
          solved.surface,
        );
        assert.ok(foot.withinFootprint);
        assert.equal(foot.plane, resolveSurface(surface).height);
        assert.equal(foot.penetration, 0);
        assert.ok(foot.gap >= 0.001 && foot.gap <= 0.004);
      }
      const primary = solved.actors[0],
        template = bodies[0];
      const world = poseJoints(
        template,
        primary.skeleton,
        primary.evaluated,
        bindCorrections(template, primary.skeleton),
        primary.hands,
      );
      const at = (name) =>
        world[template.joints.findIndex((joint) => joint.name === name)].slice(
          12,
          15,
        );
      for (const side of ["l", "r"]) {
        const wrist = at(`hand_${side}`),
          along = v3normalize(v3sub(at(`middle_01_${side}`), wrist));
        let normal = v3normalize(
          v3cross(along, v3sub(at(`pinky_01_${side}`), at(`index_01_${side}`))),
        );
        if (v3dot(v3sub(at(`thumb_01_${side}`), wrist), normal) < 0)
          normal = normal.map((n) => -n);
        assert.ok(
          normal[1] > 0.99,
          "supporting palms face upward, not sideways",
        );
        const c = solved.contacts.find(
          (c) => c.fromActor === 0 && c.fromSide === side,
        );
        const knee =
          solved.actors[1].evaluated.positions[
            solved.actors[1].skeleton.boneIndex(`knee_${c.toSide}`)
          ];
        assert.ok(
          at(`middle_01_${side}`)[1] < knee[1],
          "the palm lies beneath the held knee",
        );
      }
      const partner = solved.actors[1];
      const face = partner.evaluated.matrices[
        partner.skeleton.boneIndex("head")
      ].slice(8, 11);
      const primaryHead =
        primary.evaluated.positions[primary.skeleton.boneIndex("head")];
      const towardsHead = v3normalize([
        primaryHead[0] - partner.pose.root.position[0],
        0,
        primaryHead[2] - partner.pose.root.position[2],
      ]);
      const heading = v3normalize([face[0], 0, face[2]]);
      assert.ok(
        Math.abs(face[2]) > 0.5,
        "the head has a clear longitudinal facing",
      );
      assert.ok(
        v3dot(heading, towardsHead) * (yaw === 0 ? 1 : -1) > 0.99,
        "actual face direction distinguishes forward and reversed recipes",
      );
      assert.ok(
        solved.quality.figureSurfaces.every((p) => p.intersects === false),
      );
      assert.ok(
        solved.quality.propSurfaces.every((p) => p.intersects === false),
      );
      assert.ok(solved.quality.floorSurfaces.every((p) => p.penetration === 0));
    }
  });

  test(`${phrase}: rendered held-knee contacts also retain reversed authoring order`, () => {
    const scene = checkScene(
      portable(parseDescription(`${phrase} on the floor`).scene),
    );
    scene.contacts = scene.contacts.map(
      ({ from, to, fromActor, toActor, ...contact }) => ({
        ...contact,
        from: to,
        to: from,
        fromActor: toActor,
        toActor: fromActor,
      }),
    );
    const source = structuredClone(scene);
    const solved = solveScene(scene);
    assert.deepEqual(solvedPreview(solved).issues, []);
    refineSurfaceContacts(solved, solved.actors.map(dressed));
    assert.deepEqual(solvedPreview(solved).issues, []);
    assert.deepEqual(scene, source);
    for (const contact of solved.quality.contactDetail.slice(3)) {
      assert.equal(contact.fromActor, 1);
      assert.equal(contact.toActor, 0);
      assert.equal(contact.from, "knee");
      assert.equal(contact.to, "hand");
      assert.equal(contact.source, "custom");
      assert.equal(contact.intersects, false);
      assert.ok(contact.surfaceGap <= 0.004);
    }
  });

  test(`${phrase}: fixed capture replays the complete pose and all five contacts`, () => {
    for (const surface of ["floor", "bed"]) {
      const scene = checkScene(
        portable(parseDescription(`${phrase} on the ${surface}`).scene),
      );
      const solved = solveScene(scene),
        bodies = solved.actors.map(dressed);
      refineSurfaceContacts(solved, bodies);
      assert.deepEqual(solvedPreview(solved).issues, []);
      const positions = structuredClone(
        solved.actors.map((a) => a.evaluated.positions),
      );
      scene.actors.forEach((actor, i) =>
        Object.assign(actor, captureSolvedPose(solved.actors[i])),
      );
      const restored = solveScene(checkScene(portable(scene)));
      refineSurfaceContacts(restored, bodies);
      assert.deepEqual(solvedPreview(restored).issues, []);
      assert.equal(restored.quality.surfaceRefinement.steps, 0);
      assert.deepEqual(restored.contacts, solved.contacts);
      restored.actors.forEach((a, i) =>
        a.evaluated.positions.forEach((p, j) =>
          p.forEach((v, k) =>
            assert.ok(Math.abs(v - positions[i][j][k]) < 1e-7),
          ),
        ),
      );
    }
  });

  test(`${phrase}: missing either or both models cannot certify or adopt the guided pose`, () => {
    for (const surface of ["floor", "bed"])
      for (const missing of [0, 1, "all"]) {
        const solved = solveScene(
          checkScene(
            portable(parseDescription(`${phrase} on the ${surface}`).scene),
          ),
        );
        assert.deepEqual(solvedPreview(solved).issues, []);
        const poses = structuredClone(solved.actors.map((a) => a.pose));
        refineSurfaceContacts(
          solved,
          solved.actors
            .map(dressed)
            .map((body, i) =>
              missing === "all" || missing === i ? null : body,
            ),
        );
        assert.deepEqual(
          solved.actors.map((a) => a.pose),
          poses,
        );
        assert.ok(
          solvedPreview(solved).issues.includes("Surface check unavailable"),
        );
        assert.ok(
          !solved.quality.adjustments.some((note) =>
            note.includes("guided starting pose"),
          ),
        );
        assert.equal(solved.actors[1].supportBasis, "partner");
        assert.equal(solved.actors[1].seatResidual, null);
      }
  });
}

test("the reclining pair retains its original roles and contact with a grounded back, head, knees and forearms", () => {
  for (const surface of ["floor", "bed"]) {
    const scene = checkScene(
      portable(parseDescription(`missionary on the ${surface}`).scene),
    );
    assert.deepEqual(
      scene.actors.map((actor) => [
        actor.posture,
        actor.bodyType,
        actor.jointMode,
      ]),
      [
        ["supine", "female", "guided"],
        ["forearms_and_knees", "male", "fixed"],
      ],
    );
    assert.equal(scene.actors[0].placement.mode, "guided");
    assert.notEqual(scene.actors[1].placement.mode, "guided");
    assert.equal(scene.relationship.arrangement, "over_supine");
    const solved = solveScene(scene),
      bodies = solved.actors.map(dressed);
    assert.deepEqual(
      solvedPreview(solved).issues,
      [],
      "the default coarse gate must pass independently",
    );
    const partner = structuredClone(solved.actors[1].pose);
    refineSurfaceContacts(solved, bodies);
    assert.deepEqual(solvedPreview(solved).issues, []);
    assert.deepEqual(solved.actors[1].pose, partner);
    assert.equal(solved.quality.surfaceRefinement.steps, 1);
    assert.equal(solved.quality.surfaceRefinement.guidedPoseSteps, 1);
    assert.deepEqual(
      solved.contacts.map(({ fromActor, toActor, from, to, strength }) => [
        fromActor,
        toActor,
        from,
        to,
        strength,
      ]),
      [[1, 0, "pelvis", "pelvis", 0.9]],
    );
    assert.deepEqual(
      solved.actors.map((actor) => actor.supportBasis),
      ["surface", "partner"],
    );
    assert.deepEqual(
      solved.quality.supportSurfaces[0].supports.map(
        ({ landmark }) => landmark,
      ),
      ["upperBack", "buttocks", "head"],
    );
    assert.equal(solved.quality.supportSurfaces[1].gap, null);
    assert.equal(solved.actors[1].bodySupportResidual, null);
    assert.ok(
      solved.quality.contactDetail[0].surfaceGap >= 0.001 &&
        solved.quality.contactDetail[0].surfaceGap <= 0.004,
    );
    const query = createSurfaceContactQuery(solved.actors, bodies);
    // Partner ownership remains unchanged, but a forearms-and-knees drawing
    // must not satisfy its body contact by floating all four limbs in space.
    for (const [i, actor] of solved.actors.entries())
      for (const support of actor.posture.supports) {
        const measurement = query.support(i, support, solved.surface);
        assert.ok(measurement?.withinFootprint);
        assert.equal(measurement.plane, resolveSurface(surface).height);
        assert.equal(measurement.penetration, 0);
        assert.ok(measurement.gap <= 0.004);
      }
    for (const side of ["l", "r"]) {
      const actor = solved.actors[1];
      const at = (bone) =>
        actor.evaluated.positions[actor.skeleton.boneIndex(`${bone}_${side}`)];
      assert.ok(
        Math.abs(at("elbow")[1] - at("wrist")[1]) < 0.001,
        "supporting forearms lie along the plane",
      );
      const foot = query.support(1, { landmark: "foot", side }, solved.surface);
      assert.equal(foot.penetration, 0);
      assert.ok(foot.gap < 0.012, "relaxed feet stay close to the plane");
    }
    const faces = solved.actors.map((actor) =>
      actor.evaluated.matrices[actor.skeleton.boneIndex("head")].slice(8, 11),
    );
    assert.ok(
      faces[0][1] > 0.9 && faces[1][1] < -0.9,
      "faces point toward each other",
    );
    assert.ok(
      solved.actors.every(
        (actor) =>
          actor.evaluated.matrices[actor.skeleton.boneIndex("pelvis")][6] > 0.9,
      ),
      "heads extend in the same longitudinal direction, not head-to-toe",
    );
    assert.ok(
      solved.actors[0].bodySupportResidual > 0.025 &&
        solved.actors[0].bodySupportResidual < 0.027,
    );
    assert.equal(
      solved.actors[0].bodySupportResidual,
      measureBodySupportResidual(solved.actors[0], solved.surface),
    );
    assert.ok(
      solved.quality.figureSurfaces.every(
        (entry) => entry.intersects === false,
      ),
    );
    assert.ok(
      solved.quality.propSurfaces.every((entry) => entry.intersects === false),
    );
    assert.ok(
      solved.quality.floorSurfaces.every((entry) => entry.penetration === 0),
    );
  }
});

test("the reclining pair captures and reloads its complete geometry without a guided step", () => {
  for (const surface of ["floor", "bed"]) {
    const scene = checkScene(
      portable(parseDescription(`missionary on the ${surface}`).scene),
    );
    const solved = solveScene(scene),
      bodies = solved.actors.map(dressed);
    refineSurfaceContacts(solved, bodies);
    assert.deepEqual(solvedPreview(solved).issues, []);
    const positions = solved.actors.map((actor) =>
      actor.evaluated.positions.map((point) => point.slice()),
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
    assert.equal(restored.quality.surfaceRefinement.steps, 0);
    restored.actors.forEach((actor, i) =>
      actor.evaluated.positions.forEach((point, j) =>
        point.forEach((value, k) =>
          assert.ok(Math.abs(value - positions[i][j][k]) < 1e-7),
        ),
      ),
    );
  }
});

test("missing either model cannot certify the reclining pair or replace its coarse pose", () => {
  for (const surface of ["floor", "bed"])
    for (const missing of ["primary", "partner", "all"]) {
      const solved = solveScene(
        checkScene(
          portable(parseDescription(`missionary on the ${surface}`).scene),
        ),
      );
      assert.deepEqual(solvedPreview(solved).issues, []);
      const poses = structuredClone(solved.actors.map((actor) => actor.pose));
      const bodies = solved.actors
        .map(dressed)
        .map((body, i) =>
          missing === "all" || (missing === "primary" ? i === 0 : i === 1)
            ? null
            : body,
        );
      refineSurfaceContacts(solved, bodies);
      assert.deepEqual(
        solved.actors.map((actor) => actor.pose),
        poses,
      );
      assert.ok(
        solvedPreview(solved).issues.includes("Surface check unavailable"),
      );
      assert.ok(
        !solved.quality.adjustments.some((note) =>
          note.includes("guided starting pose"),
        ),
      );
      assert.equal(solved.actors[1].supportBasis, "partner");
      assert.equal(solved.actors[1].seatResidual, null);
    }
});

test("the kneeling pair retains palm-down hands, six supports and all three original contacts on floor and bed", () => {
  for (const surface of ["floor", "bed"]) {
    const scene = checkScene(
      portable(parseDescription(`doggy style on the ${surface}`).scene),
    );
    assert.ok(
      scene.actors.every(
        (actor) =>
          actor.jointMode === "guided" && actor.placement.mode === "guided",
      ),
    );
    assert.deepEqual(
      scene.actors.map((actor) => [actor.posture, actor.bodyType]),
      [
        ["all_fours", "female"],
        ["kneeling", "male"],
      ],
    );
    assert.equal(scene.relationship.arrangement, "rear_alignment");
    const solved = solveScene(scene),
      bodies = solved.actors.map(dressed);
    assert.deepEqual(
      solvedPreview(solved).issues,
      [],
      "coarse default passes independently",
    );
    assert.ok(
      solved.actors.every(
        (actor) => measureBodySupportResidual(actor, solved.surface) <= 0.02,
      ),
    );
    refineSurfaceContacts(solved, bodies);
    assert.deepEqual(solvedPreview(solved).issues, []);
    assert.equal(solved.quality.surfaceRefinement.steps, 1);
    assert.equal(solved.quality.surfaceRefinement.guidedPoseSteps, 1);
    assert.deepEqual(
      solved.contacts.map(
        ({ fromActor, toActor, from, to, fromSide, toSide, strength }) => [
          fromActor,
          toActor,
          from,
          to,
          fromSide ?? null,
          toSide ?? null,
          strength,
        ],
      ),
      [
        [1, 0, "pelvis", "buttocks", null, null, 0.9],
        [1, 0, "hand", "hip", "l", "l", 0.7],
        [1, 0, "hand", "hip", "r", "r", 0.7],
      ],
    );
    assert.deepEqual(
      solved.quality.supportSurfaces.map((entry) =>
        entry.supports.map(({ landmark, side }) => [landmark, side]),
      ),
      [
        [
          ["knee", "l"],
          ["knee", "r"],
          ["hand", "l"],
          ["hand", "r"],
        ],
        [
          ["knee", "l"],
          ["knee", "r"],
        ],
      ],
    );
    assert.ok(
      solved.quality.supportSurfaces.every(
        (entry) =>
          entry.unavailable === 0 &&
          entry.penetration === 0 &&
          entry.gap <= 0.004 &&
          entry.supports.every(
            ({ measurement }) =>
              measurement.withinFootprint &&
              measurement.plane === resolveSurface(surface).height,
          ),
      ),
    );
    assert.ok(
      solved.quality.contactDetail.every(
        (contact) =>
          !contact.intersects &&
          contact.surfaceGap >= 0.001 &&
          contact.surfaceGap <= 0.004,
      ),
    );
    assert.ok(
      solved.quality.figureSurfaces.every((pair) => pair.intersects === false),
    );
    assert.ok(
      solved.quality.propSurfaces.every((pair) => pair.intersects === false),
    );
    assert.ok(
      solved.quality.floorSurfaces.every((entry) => entry.penetration === 0),
    );
    assert.ok(solved.quality.renderedBalance.every((entry) => entry.supported));
    const primary = solved.actors[0],
      template = bodies[0];
    assert.ok(
      primary.bodySupportResidual > 0.02 && primary.bodySupportResidual < 0.026,
      "retain the raw knee proxy discrepancy after accepting measured supports",
    );
    assert.equal(
      primary.bodySupportResidual,
      measureBodySupportResidual(primary, solved.surface),
    );
    const world = poseJoints(
      template,
      primary.skeleton,
      primary.evaluated,
      bindCorrections(template, primary.skeleton),
      primary.hands,
    );
    const at = (name) =>
      world[template.joints.findIndex((joint) => joint.name === name)].slice(
        12,
        15,
      );
    for (const side of ["l", "r"]) {
      assert.equal(primary.hands[side], "brace");
      const wrist = at(`hand_${side}`),
        along = v3normalize(v3sub(at(`middle_01_${side}`), wrist));
      let normal = v3normalize(
        v3cross(along, v3sub(at(`pinky_01_${side}`), at(`index_01_${side}`))),
      );
      if (v3dot(v3sub(at(`thumb_01_${side}`), wrist), normal) < 0)
        normal = normal.map((n) => -n);
      assert.ok(
        normal[1] < -0.999,
        "supporting palms must face down, not stand on an edge",
      );
      assert.ok(
        along[2] > 0.999,
        "supporting fingers point forward along the shared plane",
      );
    }
  }
});

test("capturing the kneeling pair retains its complete rendered geometry without guided adoption", () => {
  for (const surface of ["floor", "bed"]) {
    const scene = checkScene(
      portable(parseDescription(`doggy style on the ${surface}`).scene),
    );
    const solved = solveScene(scene),
      bodies = solved.actors.map(dressed);
    refineSurfaceContacts(solved, bodies);
    assert.deepEqual(solvedPreview(solved).issues, []);
    const positions = solved.actors.map((actor) =>
      actor.evaluated.positions.map((point) => point.slice()),
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
    assert.equal(restored.quality.surfaceRefinement.steps, 0);
    assert.equal(restored.quality.surfaceRefinement.guidedPoseSteps, 0);
    restored.actors.forEach((actor, i) =>
      actor.evaluated.positions.forEach((point, j) =>
        point.forEach((value, k) =>
          assert.ok(Math.abs(value - positions[i][j][k]) < 1e-7),
        ),
      ),
    );
  }
});

test("missing either model cannot certify the kneeling guide or replace its coarse pose", () => {
  for (const surface of ["floor", "bed"])
    for (const missing of ["primary", "partner", "all"]) {
      const solved = solveScene(
        checkScene(
          portable(parseDescription(`doggy style on the ${surface}`).scene),
        ),
      );
      assert.deepEqual(solvedPreview(solved).issues, []);
      const poses = structuredClone(solved.actors.map((actor) => actor.pose));
      const bodies = solved.actors
        .map(dressed)
        .map((body, i) =>
          missing === "all" || (missing === "primary" ? i === 0 : i === 1)
            ? null
            : body,
        );
      refineSurfaceContacts(solved, bodies);
      assert.deepEqual(
        solved.actors.map((actor) => actor.pose),
        poses,
      );
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

test("the fixed standing carry preserves support direction and captured geometry on floor and bed", () => {
  for (const surface of ["floor", "bed"]) {
    const scene = checkScene(
      portable(parseDescription(`standing carry on the ${surface}`).scene),
    );
    const solved = solveScene(scene),
      bodies = solved.actors.map(dressed);
    assert.deepEqual(solvedPreview(solved).issues, []);
    refineSurfaceContacts(solved, bodies);
    assert.deepEqual(solvedPreview(solved).issues, []);
    assert.deepEqual(
      solved.quality.contactDetail.slice(1, 3).map((contact) => ({
        from: contact.from,
        to: contact.to,
        fromActor: contact.fromActor,
        toActor: contact.toActor,
        toSide: contact.toSide,
      })),
      ["l", "r"].map((side) => ({
        from: "buttocks",
        to: "hand",
        fromActor: 1,
        toActor: 0,
        toSide: side,
      })),
    );
    const positions = solved.actors.map((actor) =>
      actor.evaluated.positions.map((point) => point.slice()),
    );
    scene.actors.forEach((actor, i) =>
      Object.assign(actor, captureSolvedPose(solved.actors[i])),
    );
    const restored = solveScene(checkScene(portable(scene)));
    refineSurfaceContacts(restored, bodies);
    assert.deepEqual(solvedPreview(restored).issues, []);
    assert.equal(restored.quality.surfaceRefinement.steps, 0);
    restored.actors.forEach((actor, i) =>
      actor.evaluated.positions.forEach((point, j) =>
        point.forEach((value, k) =>
          assert.ok(Math.abs(value - positions[i][j][k]) < 1e-7),
        ),
      ),
    );
  }
});

test("standing carry without scanned geometry remains fixed and labels its checks unavailable", () => {
  for (const surface of ["floor", "bed"]) {
    const solved = solveScene(
      checkScene(
        portable(parseDescription(`standing carry on the ${surface}`).scene),
      ),
    );
    assert.deepEqual(solvedPreview(solved).issues, []);
    const poses = structuredClone(solved.actors.map((actor) => actor.pose));
    refineSurfaceContacts(solved, [null, null]);
    assert.deepEqual(
      solved.actors.map((actor) => actor.pose),
      poses,
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
  }
});

test("the mixed table layout retains four tabletop/floor supports and two partner foot supports through capture", () => {
  const scene = checkScene(
    portable(parseDescription("bent over the table").scene),
  );
  assert.equal(scene.actors[0].jointMode, "fixed");
  assert.equal(scene.actors[0].placement.mode, undefined);
  assert.equal(scene.actors[1].jointMode, "guided");
  assert.equal(scene.actors[1].placement.mode, "guided");
  const solved = solveScene(scene),
    bodies = solved.actors.map(dressed);
  assert.deepEqual(solvedPreview(solved).issues, []);
  const fixedPrimary = structuredClone(solved.actors[0].pose);
  refineSurfaceContacts(solved, bodies);
  assert.deepEqual(solvedPreview(solved).issues, []);
  assert.deepEqual(solved.actors[0].pose, fixedPrimary);
  assert.deepEqual(
    solved.actors.map((actor) => actor.supportBasis),
    ["surface", "surface"],
  );
  assert.deepEqual(
    solved.quality.supportSurfaces.map((report) =>
      report.supports.map((support) => [
        support.landmark,
        support.measurement.plane,
      ]),
    ),
    [
      [
        ["chest", 0.75],
        ["hips", 0.75],
        ["foot", 0],
        ["foot", 0],
      ],
      [
        ["foot", 0],
        ["foot", 0],
      ],
    ],
  );
  assert.ok(
    solved.quality.supportSurfaces.every(
      (report) =>
        report.gap <= 0.004 &&
        report.penetration === 0 &&
        report.unavailable === 0 &&
        report.supports.every((support) => support.measurement.withinFootprint),
    ),
  );
  const positions = solved.actors.map((actor) =>
    actor.evaluated.positions.map((point) => point.slice()),
  );
  scene.actors.forEach((actor, i) =>
    Object.assign(actor, captureSolvedPose(solved.actors[i])),
  );
  const restored = solveScene(checkScene(portable(scene)));
  refineSurfaceContacts(restored, bodies);
  assert.deepEqual(solvedPreview(restored).issues, []);
  assert.equal(restored.quality.surfaceRefinement.steps, 0);
  restored.actors.forEach((actor, i) =>
    actor.evaluated.positions.forEach((point, j) =>
      point.forEach((value, k) =>
        assert.ok(Math.abs(value - positions[i][j][k]) < 1e-7),
      ),
    ),
  );
});

test("missing geometry cannot certify or replace the table layout's coarse pose", () => {
  for (const missing of ["partner", "all"]) {
    const solved = solveScene(
      checkScene(portable(parseDescription("bent over the table").scene)),
    );
    assert.deepEqual(solvedPreview(solved).issues, []);
    const before = structuredClone(solved.actors.map((actor) => actor.pose));
    const bodies = solved.actors.map(dressed);
    refineSurfaceContacts(
      solved,
      missing === "all" ? [null, null] : [bodies[0], null],
    );
    assert.deepEqual(
      solved.actors.map((actor) => actor.pose),
      before,
    );
    assert.ok(
      solvedPreview(solved).issues.includes("Surface check unavailable"),
    );
    assert.ok(
      solvedPreview(solved).issues.includes("Support check unavailable"),
    );
    assert.ok(
      solvedPreview(solved).issues.includes("Furniture check unavailable"),
    );
    assert.ok(
      !solved.quality.adjustments.some((note) =>
        note.includes("guided starting pose"),
      ),
    );
  }
});
