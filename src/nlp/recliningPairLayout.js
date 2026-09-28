/** Clothed face-to-face reclining pair: guided primary and fixed partner.
 * The original contact and surface/partner support ownership are retained. */
export const RECLINING_PAIR_LAYOUT = {
  referenceHeight: 0,
  surfaces: ["bed", "floor"],
  yaw: 0,
  camera: {
    view: "side",
  },
  actors: [
    {
      posture: "supine",
      bodyType: "female",
      wearing: ["top", "shorts"],
      outfit: "sage",
      build: 1,
      jointMode: "guided",
      placement: {
        position: [0, 0.11558745276260013, 0.07],
        rotation: [-87.12854956443859, 0, 180],
        mode: "guided",
      },
      joints: {
        spine01: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        spine02: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        spine03: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        neck: {
          flexion: -3,
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
          flexion: -30,
          abduction: 130,
          rotation: 0,
        },
        elbow_l: {
          flexion: 16,
          abduction: 0,
          rotation: 0,
        },
        wrist_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: -30,
          abduction: 130,
          rotation: 0,
        },
        elbow_r: {
          flexion: 16,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        hip_l: {
          flexion: 0,
          abduction: 55,
          rotation: 0,
        },
        knee_l: {
          flexion: 8,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 25,
          abduction: 0,
          rotation: 0,
        },
        toe_l: {
          flexion: 20,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 0,
          abduction: 55,
          rotation: 0,
        },
        knee_r: {
          flexion: 8,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 25,
          abduction: 0,
          rotation: 0,
        },
        toe_r: {
          flexion: 20,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "relaxed",
        r: "relaxed",
      },
      stature: 1.66,
      bust: 1,
    },
    {
      posture: "forearms_and_knees",
      bodyType: "male",
      wearing: ["top", "shorts"],
      outfit: "navy",
      build: 1,
      jointMode: "fixed",
      joints: {
        spine01: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        spine02: {
          flexion: -10,
          abduction: 0,
          rotation: 0,
        },
        spine03: {
          flexion: -10,
          abduction: 0,
          rotation: 0,
        },
        neck: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        head: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_l: {
          flexion: -20,
          abduction: 0,
          rotation: 10,
        },
        shoulder_l: {
          flexion: 116.97171693416148,
          abduction: 28.67006258766915,
          rotation: 4.797916439633092,
        },
        elbow_l: {
          flexion: 90.00000000000004,
          abduction: 0,
          rotation: -75,
        },
        wrist_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_r: {
          flexion: -20,
          abduction: 0,
          rotation: 10,
        },
        shoulder_r: {
          flexion: 116.97171693416148,
          abduction: 28.67006258766915,
          rotation: 4.797916439633092,
        },
        elbow_r: {
          flexion: 90.00000000000004,
          abduction: 0,
          rotation: -75,
        },
        wrist_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        hip_l: {
          flexion: 24.026185123159635,
          abduction: 10,
          rotation: 0,
        },
        knee_l: {
          flexion: 41.026185123159635,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 50,
          abduction: 0,
          rotation: 0,
        },
        toe_l: {
          flexion: 38,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 24.026185123159635,
          abduction: 10,
          rotation: 0,
        },
        knee_r: {
          flexion: 41.026185123159635,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 50,
          abduction: 0,
          rotation: 0,
        },
        toe_r: {
          flexion: 38,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "relaxed",
        r: "relaxed",
      },
      stature: 1.78,
      bust: 0,
      placement: {
        position: [0, 0.3238183593749999, -0.05],
        rotation: [75, 0, 0],
      },
    },
  ],
};
