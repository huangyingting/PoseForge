/** Clothed hands-and-knees pair, adopted only after full rendered validation.
 * Original figure roles, six supports and three contacts are unchanged. */
export const KNEELING_PAIR_LAYOUT = {
  referenceHeight: 0,
  surfaces: ["bed", "floor"],
  yaw: 0,
  camera: {
    view: "side",
  },
  actors: [
    {
      posture: "all_fours",
      bodyType: "female",
      wearing: ["top", "shorts"],
      outfit: "sage",
      build: 1,
      jointMode: "guided",
      placement: {
        position: [0, 0.42254713277401473, -0.10328097189304769],
        rotation: [85, 0, 0],
        mode: "guided",
      },
      joints: {
        spine01: {
          flexion: -2,
          abduction: 0,
          rotation: 0,
        },
        spine02: {
          flexion: -2,
          abduction: 0,
          rotation: 0,
        },
        spine03: {
          flexion: -2,
          abduction: 0,
          rotation: 0,
        },
        neck: {
          flexion: 26,
          abduction: 0,
          rotation: 0,
        },
        head: {
          flexion: 14,
          abduction: 0,
          rotation: 0,
        },
        clavicle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_l: {
          flexion: 62.21183441817231,
          abduction: 7.479928047421974,
          rotation: -16.02595369069495,
        },
        elbow_l: {
          flexion: 79.48099242471285,
          abduction: 0,
          rotation: 67.54481523477104,
        },
        wrist_l: {
          flexion: 22.233329905724506,
          abduction: 35,
          rotation: 15,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 62.21183441817231,
          abduction: 7.479928047421974,
          rotation: -16.02595369069495,
        },
        elbow_r: {
          flexion: 79.48099242471285,
          abduction: 0,
          rotation: 67.54481523477104,
        },
        wrist_r: {
          flexion: 22.233329905724506,
          abduction: 35,
          rotation: 15,
        },
        hip_l: {
          flexion: 96.84038892994303,
          abduction: 11.545509254385982,
          rotation: 1.858273623405078,
        },
        knee_l: {
          flexion: 107.16720452415656,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 45.86964954488935,
          abduction: -0.38905082944347347,
          rotation: 0.7728607212550064,
        },
        toe_l: {
          flexion: 38,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 96.84038776876726,
          abduction: 11.545509301783653,
          rotation: 1.8582758473968795,
        },
        knee_r: {
          flexion: 107.1672150575284,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 45.86963788779716,
          abduction: -0.3890519338747155,
          rotation: 0.7728629154401302,
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
    {
      posture: "kneeling",
      bodyType: "male",
      wearing: ["top", "shorts"],
      outfit: "navy",
      build: 1,
      jointMode: "guided",
      placement: {
        position: [0, 0.40907265785343383, -0.31811523437499994],
        rotation: [3.5000000000000027, 0, 0],
        mode: "guided",
      },
      joints: {
        spine01: {
          flexion: 1,
          abduction: 0,
          rotation: 0,
        },
        spine02: {
          flexion: 1,
          abduction: 0,
          rotation: 0,
        },
        spine03: {
          flexion: 1,
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
          flexion: 1.2038158483874044,
          abduction: 13.269228231798818,
          rotation: 3.6089884385387934,
        },
        elbow_l: {
          flexion: 53.49989291833296,
          abduction: 0,
          rotation: 0,
        },
        wrist_l: {
          flexion: 3.2506903323908074,
          abduction: -21.117506034137723,
          rotation: 14.325848042012186,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 1.2038158854046825,
          abduction: 13.269228116140118,
          rotation: 3.6089873507306383,
        },
        elbow_r: {
          flexion: 53.499891025102194,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: 3.2506917061934772,
          abduction: -21.117506877182425,
          rotation: 14.325848807452783,
        },
        hip_l: {
          flexion: 0,
          abduction: 34,
          rotation: 0,
        },
        knee_l: {
          flexion: 92.44722118007545,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 49.53454885246031,
          abduction: -0.042760222075477285,
          rotation: 0.054730606920661194,
        },
        toe_l: {
          flexion: 38,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 0,
          abduction: 34,
          rotation: 0,
        },
        knee_r: {
          flexion: 92.44720433101027,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 49.534566463931,
          abduction: -0.04275860432301141,
          rotation: 0.054728536289836045,
        },
        toe_r: {
          flexion: 38,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "grip",
        r: "grip",
      },
      stature: 1.78,
      bust: 0,
    },
  ],
};
