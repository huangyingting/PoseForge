/** Clothed floor/bed seated embrace with all five original contacts retained.
 * Guided hints are adopted only after complete rendered-geometry validation. */
export const SEATED_EMBRACE_LAYOUT = {
  referenceHeight: 0,
  surfaces: ["floor", "bed"],
  yaw: 180,
  camera: {
    view: "side",
  },
  actors: [
    {
      posture: "seated",
      bodyType: "male",
      wearing: ["top", "shorts"],
      outfit: "sage",
      build: 1,
      stature: 1.78,
      bust: 0,
      jointMode: "guided",
      placement: {
        position: [0, 0.0770052869124438, -0.38652246899159076],
        rotation: [-55.99193572998045, 0, 0],
        mode: "guided",
      },
      joints: {
        spine01: {
          flexion: -8,
          abduction: 0,
          rotation: 0,
        },
        spine02: {
          flexion: -8,
          abduction: 0,
          rotation: 0,
        },
        spine03: {
          flexion: -8,
          abduction: 0,
          rotation: 0,
        },
        neck: {
          flexion: 19,
          abduction: 0,
          rotation: 0,
        },
        head: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_l: {
          flexion: 50.09617644309105,
          abduction: 46.887391329010576,
          rotation: 43.49791064502107,
        },
        elbow_l: {
          flexion: 126.6796045681713,
          abduction: 0,
          rotation: 0,
        },
        wrist_l: {
          flexion: -49.25219039184771,
          abduction: 2.084232078313406,
          rotation: -0.09418276985314168,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 50.09619548947779,
          abduction: 46.887377017733336,
          rotation: 43.49792720595344,
        },
        elbow_r: {
          flexion: 126.67962364652516,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: -49.25217421748301,
          abduction: 2.084235248206986,
          rotation: -0.09418252297791142,
        },
        hip_l: {
          flexion: 86.13269701058191,
          abduction: 10.734140008589566,
          rotation: 2.7922556567171486,
        },
        knee_l: {
          flexion: 100.74761519717515,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: -11.308389023920737,
          abduction: 0.7492000773273272,
          rotation: 0.2839823248080851,
        },
        toe_l: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 86.1298857645017,
          abduction: 10.949854711104443,
          rotation: 2.7652379638471873,
        },
        knee_r: {
          flexion: 100.74679798644634,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: -11.319402679662128,
          abduction: 0.8155425001709127,
          rotation: 0.30672399401114075,
        },
        toe_r: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "open",
        r: "open",
      },
    },
    {
      posture: "seated_straddle",
      bodyType: "female",
      wearing: ["top", "shorts"],
      outfit: "navy",
      build: 1,
      stature: 1.66,
      bust: 1,
      jointMode: "guided",
      placement: {
        position: [0, 0.39150392437137216, -0.3877855113101655],
        rotation: [149.00806427001953, 0, 180],
        mode: "guided",
      },
      joints: {
        spine01: {
          flexion: 2,
          abduction: 0,
          rotation: 0,
        },
        spine02: {
          flexion: 2,
          abduction: 0,
          rotation: 0,
        },
        spine03: {
          flexion: 2,
          abduction: 0,
          rotation: 0,
        },
        neck: {
          flexion: -15,
          abduction: 0,
          rotation: 0,
        },
        head: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_l: {
          flexion: 19.55210282980577,
          abduction: 55.19731317222438,
          rotation: 37.24233052883355,
        },
        elbow_l: {
          flexion: 114.12444841471616,
          abduction: 0,
          rotation: 0,
        },
        wrist_l: {
          flexion: -18.340232305312348,
          abduction: 0.6640174912031339,
          rotation: -0.18518505292535892,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 15.04114529434645,
          abduction: 56.02151001757986,
          rotation: 34.05254962229314,
        },
        elbow_r: {
          flexion: 116.0427058343516,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: -23.133141617338,
          abduction: 1.0915263324698286,
          rotation: -0.3620399490941479,
        },
        hip_l: {
          flexion: 65,
          abduction: 55,
          rotation: 0,
        },
        knee_l: {
          flexion: 130,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 20,
          abduction: 0,
          rotation: 0,
        },
        toe_l: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 65,
          abduction: 55,
          rotation: 0,
        },
        knee_r: {
          flexion: 130,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 20,
          abduction: 0,
          rotation: 0,
        },
        toe_r: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "grip",
        r: "grip",
      },
    },
  ],
};
