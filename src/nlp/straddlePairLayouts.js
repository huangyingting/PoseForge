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
          flexion: -1.7545140492682798,
          abduction: 15.148564365107518,
          rotation: 22.610434967711164,
        },
        elbow_l: {
          flexion: 1.6188656337283132,
          abduction: 0,
          rotation: -79.97488846700938,
        },
        wrist_l: {
          flexion: 67.99855386911668,
          abduction: 35,
          rotation: -15,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: -1.7545597591633133,
          abduction: 15.1485722996032,
          rotation: 22.610439980301386,
        },
        elbow_r: {
          flexion: 1.6189212043018069,
          abduction: 0,
          rotation: -79.9748921454994,
        },
        wrist_r: {
          flexion: 67.99865803024306,
          abduction: 35,
          rotation: -15,
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
          flexion: 51.851287227894986,
          abduction: 18.050106251607055,
          rotation: 85,
        },
        elbow_l: {
          flexion: 62.56229679622419,
          abduction: 0,
          rotation: 51.058765622885595,
        },
        wrist_l: {
          flexion: -70,
          abduction: 35,
          rotation: -15,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 51.851292338883084,
          abduction: 18.050106101929444,
          rotation: 85,
        },
        elbow_r: {
          flexion: 62.56228439730497,
          abduction: 0,
          rotation: 51.058648576770175,
        },
        wrist_r: {
          flexion: -70,
          abduction: 35,
          rotation: -15,
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
          flexion: -10.805586017654743,
          abduction: 20.521587411052835,
          rotation: 11.341990652573193,
        },
        elbow_l: {
          flexion: 22.652146210808652,
          abduction: 0,
          rotation: -75.81292244159572,
        },
        wrist_l: {
          flexion: 67.45351696080185,
          abduction: 35,
          rotation: -4.421628652447892,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: -10.805587523631951,
          abduction: 20.521581944044588,
          rotation: 11.341957879799656,
        },
        elbow_r: {
          flexion: 22.652146856757767,
          abduction: 0,
          rotation: -75.81284356252894,
        },
        wrist_r: {
          flexion: 67.45353266646363,
          abduction: 35,
          rotation: -4.421746360502357,
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
          flexion: -55.28912721586077,
          abduction: 18.01251300434069,
          rotation: 85,
        },
        elbow_l: {
          flexion: 62.754342897710885,
          abduction: 0,
          rotation: 85,
        },
        wrist_l: {
          flexion: 75,
          abduction: -5.971079487143441,
          rotation: 15,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: -55.28911599391997,
          abduction: 18.012523669564366,
          rotation: 85,
        },
        elbow_r: {
          flexion: 62.75433690110644,
          abduction: 0,
          rotation: 85,
        },
        wrist_r: {
          flexion: 75,
          abduction: -5.97113972296595,
          rotation: 15,
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
