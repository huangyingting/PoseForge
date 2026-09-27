"""
MakeHuman plugin: build one body from a spec and write it as FBX.

`make-bodies.mjs` copies this into MakeHuman's user plugin folder and starts
MakeHuman once per body with two variables set:

  POSEFORGE_BODY    the body's entry from bodies.json, as JSON
  POSEFORGE_OUTPUT  where to write the FBX

and `make-hair.mjs` starts it the same way with a third, and usually without
POSEFORGE_OUTPUT, since what it wants is the fit and not the body:

  POSEFORGE_TRIM    {"proxies": [[name, kind, path], ...], "output": ...},
                    the hair, eyebrow and eyelash proxies to fit to the body
                    and the JSON file to write them to (see `trim`)

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


def trim(human, proxies, output):
    """
    Fit each named proxy - a hairstyle, eyebrows, eyelashes - to this body and
    write what the app needs to draw it, without exporting it.

    A proxy is a mesh whose every vertex is a weighted sum of three base-mesh
    vertices plus an offset, and most of the ones a hairstyle leans on are the
    base mesh's hidden helper geometry, which no exported body carries. So the
    fitting has to happen here, where the helpers exist, and it is done in the
    rest pose on the body just built. The body's own visible vertices go out
    beside the proxies so `make-hair.mjs` can find the transform from these
    coordinates to the GLB's by matching them, rather than by trusting a chain
    of export scales and axis swaps.
    """
    import numpy as np
    import proxy

    mesh = human.meshData
    coords = human.getRestposeCoordinates()
    visible = mesh.getVertexMaskForFaceMask(mesh.getFaceMask())
    skel = human.getSkeleton()
    raw = human.getVertexWeights(skel)
    result = {"body": np.asarray(coords[visible], dtype=float).round(6).tolist(), "proxies": {}}
    for name, kind, path in proxies:
        pxy = proxy.loadProxy(human, getpath.getSysDataPath(path), type=kind)
        pmesh, _ = pxy.loadMeshAndObject(human)
        weights = pxy.getVertexWeights(raw, skel)
        result["proxies"][name] = {
            "coords": np.asarray(pxy.getCoords(), dtype=float).round(6).tolist(),
            "faces": np.asarray(pmesh.fvert).tolist(),
            "faceUVs": np.asarray(pmesh.fuvs).tolist(),
            "uvs": np.asarray(pmesh.texco, dtype=float).round(6).tolist(),
            "weights": {
                bone: [np.asarray(verts).tolist(), np.asarray(values, dtype=float).round(6).tolist()]
                for bone, (verts, values) in weights.data.items()
            },
        }
    with open(output, "w") as handle:
        json.dump(result, handle)


def load(app):
    spec = os.environ.get("POSEFORGE_BODY")
    if not spec:
        return
    body = json.loads(spec)
    output = os.environ.get("POSEFORGE_OUTPUT")
    trimmed = os.environ.get("POSEFORGE_TRIM")

    def generate():
        try:
            build(app.selectedHuman, body)
            if trimmed:
                request = json.loads(trimmed)
                trim(app.selectedHuman, request["proxies"], request["output"])
            if output:
                app.mhapi.exports.exportAsFBX(output, useExportsDir=False)
        finally:
            app.stop()
        return False

    # After start-up has finished loading the default human.
    mh.addTimer(1200, generate)


def unload(app):
    pass
