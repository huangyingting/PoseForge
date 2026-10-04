/** Clothed seated-over-reclining layouts, independently fitted in each facing.
 * Both actors use guided placement. The explicit knee supports belong to the
 * archetype's editable contact graph, alongside the three arrangement links. */
export const STRADDLE_PAIR_LAYOUT = {
  referenceHeight: 0,
  surfaces: ["bed", "floor"],
  yaw: 0,
  camera: {
    view: "three_quarter",
  },
  actors: [
    {
      posture: "supine",
      bodyType: "male",
      wearing: ["top", "shorts"],
      outfit: "sage",
      build: 1,
      jointMode: "guided",
      placement: {
        position: [0, 0.10139534768406289, 0],
        rotation: [-93.9124247853983, 0, 180],
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
          flexion: 8.3,
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
          flexion: -15.98,
          abduction: 22.97,
          rotation: -12.58,
        },
        elbow_l: {
          flexion: 30.79,
          abduction: 0,
          rotation: -80,
        },
        wrist_l: {
          flexion: -15.63,
          abduction: -0.31,
          rotation: -0.94,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: -15.98,
          abduction: 22.97,
          rotation: -12.58,
        },
        elbow_r: {
          flexion: 30.79,
          abduction: 0,
          rotation: -80,
        },
        wrist_r: {
          flexion: -15.63,
          abduction: -0.31,
          rotation: -0.94,
        },
        hip_l: {
          flexion: 12,
          abduction: 7,
          rotation: 0,
        },
        knee_l: {
          flexion: 18.017187753101528,
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
          flexion: 12,
          abduction: 7,
          rotation: 0,
        },
        knee_r: {
          flexion: 18.017177743859346,
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
        l: "brace",
        r: "brace",
      },
      stature: 1.78,
      bust: 0,
    },
    {
      posture: "kneeling_straddle",
      bodyType: "female",
      wearing: ["top", "shorts"],
      outfit: "navy",
      build: 1,
      jointMode: "guided",
      placement: {
        position: [0, 0.3418823242187499, 0],
        rotation: [15.000000000000014, 0, 0],
        mode: "guided",
      },
      joints: {
        spine01: {
          flexion: -10,
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
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_l: {
          flexion: 59.66,
          abduction: 24.25,
          rotation: 67.5,
        },
        elbow_l: {
          flexion: 43.28,
          abduction: 0,
          rotation: 85,
        },
        wrist_l: {
          flexion: -76.76,
          abduction: 2.5,
          rotation: 4.13,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 59.66,
          abduction: 24.25,
          rotation: 67.5,
        },
        elbow_r: {
          flexion: 43.28,
          abduction: 0,
          rotation: 85,
        },
        wrist_r: {
          flexion: -76.76,
          abduction: 2.5,
          rotation: 4.13,
        },
        hip_l: {
          flexion: 27.53357281193928,
          abduction: 65,
          rotation: 0,
        },
        knee_l: {
          flexion: 91.35223190584868,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 49.52413415303076,
          abduction: -0.1998591717321709,
          rotation: 0.5123543538026085,
        },
        toe_l: {
          flexion: 38,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 27.533572575350092,
          abduction: 65,
          rotation: 0,
        },
        knee_r: {
          flexion: 91.35223793059146,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 49.52413131708231,
          abduction: -0.19986036623615225,
          rotation: 0.5123574161119167,
        },
        toe_r: {
          flexion: 38,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "brace",
        r: "brace",
      },
      stature: 1.66,
      bust: 1,
    },
  ],
};

export const REVERSE_STRADDLE_PAIR_LAYOUT = {
  referenceHeight: 0,
  surfaces: ["bed", "floor"],
  yaw: 180,
  camera: {
    view: "three_quarter",
  },
  actors: [
    {
      posture: "supine",
      bodyType: "male",
      wearing: ["top", "shorts"],
      outfit: "sage",
      build: 1,
      jointMode: "guided",
      placement: {
        position: [0, 0.10139534768406289, 0],
        rotation: [-93.9124247853983, 0, 180],
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
          flexion: 8.3,
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
          flexion: -14.99,
          abduction: 17.26,
          rotation: -12.79,
        },
        elbow_l: {
          flexion: 31.39,
          abduction: 0,
          rotation: -80,
        },
        wrist_l: {
          flexion: -16.56,
          abduction: -0.31,
          rotation: -0.94,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: -14.99,
          abduction: 17.26,
          rotation: -12.79,
        },
        elbow_r: {
          flexion: 31.39,
          abduction: 0,
          rotation: -80,
        },
        wrist_r: {
          flexion: -16.56,
          abduction: -0.31,
          rotation: -0.94,
        },
        hip_l: {
          flexion: 12,
          abduction: 7,
          rotation: 0,
        },
        knee_l: {
          flexion: 18.017187753101528,
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
          flexion: 12,
          abduction: 7,
          rotation: 0,
        },
        knee_r: {
          flexion: 18.017177743859346,
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
        l: "brace",
        r: "brace",
      },
      stature: 1.78,
      bust: 0,
    },
    {
      posture: "kneeling_straddle",
      bodyType: "female",
      wearing: ["top", "shorts"],
      outfit: "navy",
      build: 1,
      jointMode: "guided",
      placement: {
        position: [0, 0.3384750366210937, 0],
        rotation: [-165, 0, -180],
        mode: "guided",
      },
      joints: {
        spine01: {
          flexion: 10,
          abduction: 0,
          rotation: 0,
        },
        spine02: {
          flexion: 10,
          abduction: 0,
          rotation: 0,
        },
        spine03: {
          flexion: 10,
          abduction: 0,
          rotation: 0,
        },
        neck: {
          flexion: -30,
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
          flexion: -60,
          abduction: 25,
          rotation: 68.25,
        },
        elbow_l: {
          flexion: 58,
          abduction: 0,
          rotation: 84,
        },
        wrist_l: {
          flexion: -61,
          abduction: 3,
          rotation: -2,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: -60,
          abduction: 25,
          rotation: 68.25,
        },
        elbow_r: {
          flexion: 58,
          abduction: 0,
          rotation: 84,
        },
        wrist_r: {
          flexion: -61,
          abduction: 3,
          rotation: -2,
        },
        hip_l: {
          flexion: -2.4664271880607203,
          abduction: 65,
          rotation: 0,
        },
        knee_l: {
          flexion: 92.16886528427209,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 49.52413415303076,
          abduction: -0.1998591717321709,
          rotation: 0.5123543538026085,
        },
        toe_l: {
          flexion: 38,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: -2.4664274246499076,
          abduction: 65,
          rotation: 0,
        },
        knee_r: {
          flexion: 92.1688713706578,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 49.52413131708231,
          abduction: -0.19986036623615225,
          rotation: 0.5123574161119167,
        },
        toe_r: {
          flexion: 38,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "brace",
        r: "brace",
      },
      stature: 1.66,
      bust: 1,
    },
  ],
};
