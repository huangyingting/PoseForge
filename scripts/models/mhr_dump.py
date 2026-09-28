"""
Blender: read one of Meta's MHR bodies into the flat arrays make-fine-bodies.mjs
builds from.

    blender --background --factory-startup --python mhr_dump.py -- in.fbx out.bin

The FBX's armature carries a 0.01 scale and a quarter turn about X, and a few
dozen collision empties nothing here needs. Both transforms are applied, so
everything written is in Blender's world frame, in metres: Z up, the body facing
-Y, its left hand at +X - which is the frame the MakeHuman bodies' GLBs store
their vertices in too.

Written, after a little-endian uint32 byte count and that many bytes of JSON
naming the rest:

    positions  float32 [vertex][3]            the mean body
    identity   float32 [shape][vertex][3]     each identity shape's offset
    triangles  uint32  [triangle][3]
    influences uint16  [vertex][8] group, float32 [vertex][8] weight

The JSON lists the bones (name, parent, head, tail), the vertex groups in the
order `influences` counts them, and the identity shapes' names. Only the first
45 shape keys are identity (20 body, 20 head, 5 hand); the rest are the face's
expressions and are left out.
"""
import json
import struct
import sys

import bpy
import numpy as np

IDENTITY = 45
INFLUENCES = 8

source, target = sys.argv[sys.argv.index("--") + 1:][:2]

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.fbx(filepath=source, automatic_bone_orientation=False)

for obj in list(bpy.context.scene.objects):
    if obj.type not in {"MESH", "ARMATURE"}:
        bpy.data.objects.remove(obj, do_unlink=True)
armature = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.context.scene.objects if o.type == "MESH")

bpy.ops.object.select_all(action="DESELECT")
for obj in (armature, mesh):
    obj.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
world = np.array(mesh.matrix_world)
assert np.allclose(world, np.eye(4), atol=1e-6), "the mesh kept a transform"

data = mesh.data
count = len(data.vertices)
keys = data.shape_keys.key_blocks


def read(block):
    out = np.empty(count * 3, dtype=np.float32)
    block.data.foreach_get("co", out)
    return out.reshape(count, 3)


basis = read(keys[0])
names = [keys[i].name for i in range(1, IDENTITY + 1)]
identity = np.stack([read(keys[name]) - basis for name in names]).astype(np.float32)

data.calc_loop_triangles()
triangles = np.empty(len(data.loop_triangles) * 3, dtype=np.uint32)
data.loop_triangles.foreach_get("vertices", triangles)

groups = [g.name for g in mesh.vertex_groups]
index = np.zeros((count, INFLUENCES), dtype=np.uint16)
weight = np.zeros((count, INFLUENCES), dtype=np.float32)
for v in data.vertices:
    pairs = sorted(((g.weight, g.group) for g in v.groups if g.weight > 0), reverse=True)
    if len(pairs) > INFLUENCES:
        raise SystemExit(f"vertex {v.index} has {len(pairs)} influences")
    for k, (w, g) in enumerate(pairs):
        index[v.index, k] = g
        weight[v.index, k] = w

bones = [
    {
        "name": b.name,
        "parent": b.parent.name if b.parent else None,
        "head": list(map(float, b.head_local)),
        "tail": list(map(float, b.tail_local)),
    }
    for b in armature.data.bones
]
header = json.dumps(
    {"vertices": count, "triangles": len(triangles) // 3, "influences": INFLUENCES, "bones": bones, "groups": groups, "identity": names}
).encode()
with open(target, "wb") as out:
    out.write(struct.pack("<I", len(header)))
    out.write(header)
    for array in (basis, identity, triangles, index, weight):
        out.write(np.ascontiguousarray(array).tobytes())
print(f"wrote {count} vertices, {len(triangles) // 3} triangles, {len(bones)} bones")
