"""
Blender script: convert a MakeHuman FBX into the GLB layout assets/models uses.

  blender --background --factory-startup --python fbx_to_glb.py -- \
      body.fbx realistic-<name>.glb <name>

What `buildHumanTemplate` reads, and so what this has to leave behind: one
armature, the skinned body mesh first and the high-poly eye proxy after it,
smooth normals made consistent, and two plain opaque materials. The skin
photograph is not embedded - it ships beside the GLB as a PNG atlas that the
renderers load themselves, addressed by the same UVs.
"""

import sys

import bpy

source_path, output_path, character_name = sys.argv[-3:]

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=source_path, automatic_bone_orientation=False)

armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
rigged_meshes = [
    obj
    for obj in bpy.context.scene.objects
    if obj.type == "MESH"
    and any(modifier.type == "ARMATURE" for modifier in obj.modifiers)
]
if not rigged_meshes or len(armatures) != 1:
    raise RuntimeError(
        f"Expected rigged meshes and one armature, got {len(rigged_meshes)} "
        f"meshes and {len(armatures)} armatures"
    )

armature = armatures[0]
keep = {armature, *rigged_meshes}
for obj in list(bpy.context.scene.objects):
    if obj not in keep:
        bpy.data.objects.remove(obj, do_unlink=True)

armature.name = f"{character_name}_rig"
for mesh in rigged_meshes:
    is_body = "high-poly" not in mesh.name.lower()
    mesh.name = (
        f"{character_name}_body" if is_body else f"{character_name}_{mesh.name}"
    )

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    for polygon in mesh.data.polygons:
        polygon.use_smooth = True
    material = bpy.data.materials.new(f"{mesh.name}_material")
    material.diffuse_color = (
        (0.78, 0.58, 0.45, 1.0) if is_body else (0.12, 0.055, 0.025, 1.0)
    )
    material.metallic = 0.0
    material.roughness = 0.58
    material.blend_method = "OPAQUE"
    mesh.data.materials.clear()
    mesh.data.materials.append(material)

bpy.ops.object.select_all(action="DESELECT")
for obj in keep:
    obj.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format="GLB",
    use_selection=True,
    export_skins=True,
    export_animations=False,
    export_apply=False,
    export_yup=True,
)
