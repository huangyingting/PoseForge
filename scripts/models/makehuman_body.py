"""
MakeHuman plugin: build one body from a spec and write it as FBX.

`make-bodies.mjs` copies this into MakeHuman's user plugin folder and starts
MakeHuman once per body with two variables set:

  POSEFORGE_BODY    the body's entry from bodies.json, as JSON
  POSEFORGE_OUTPUT  where to write the FBX

Without them the plugin does nothing, so an ordinary MakeHuman session that
finds it installed is unaffected.

The macro sliders are set in the order the spec lists them, through the same
setters the Macro modelling tab uses, because the ethnic ones renormalise each
other: setting Asian to 1 is what takes African and Caucasian to 0. Any other
modifier (breast size, say) is set by name afterwards. The skin is the named
MakeHuman material, and the rig is the game-engine skeleton every body in
assets/models is retargeted from.
"""

import json
import os

import getpath
import material
import mh
import skeleton

MACROS = {
    "african": "setAfrican",
    "asian": "setAsian",
    "caucasian": "setCaucasian",
    "gender": "setGender",
    "age": "setAge",
    "height": "setHeight",
    "muscle": "setMuscle",
    "weight": "setWeight",
    "proportions": "setBodyProportions",
}


def build(human, body):
    for name, value in body["macros"].items():
        getattr(human, MACROS[name])(value)
    for name, value in body.get("modifiers", {}).items():
        human.getModifier(name).setValue(value)
    human.applyAllTargets()
    human.material = material.fromFile(
        "data/skins/%s/%s.mhmat" % (body["skin"], body["skin"])
    )

    reference = human.getBaseSkeleton()
    rig = skeleton.load(
        getpath.getSysDataPath("rigs/game_engine.mhskel"), human.meshData
    )
    rig.autoBuildWeightReferences(reference)
    rig.getVertexWeights(reference.getVertexWeights(), force_remap=False)
    rig.addReferencePlanes(reference)
    human.setSkeleton(rig)


def load(app):
    spec = os.environ.get("POSEFORGE_BODY")
    if not spec:
        return
    body = json.loads(spec)
    output = os.environ["POSEFORGE_OUTPUT"]

    def generate():
        try:
            build(app.selectedHuman, body)
            app.mhapi.exports.exportAsFBX(output, useExportsDir=False)
        finally:
            app.stop()
        return False

    # After start-up has finished loading the default human.
    mh.addTimer(1200, generate)


def unload(app):
    pass
