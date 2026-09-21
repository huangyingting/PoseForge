/** Clothed table-supported pair: fixed support figure and a validated partner guide.
 * All original supports and contacts are retained on the unchanged table. */
export const TABLE_SUPPORT_LAYOUT = {
  referenceHeight: 0.75,
  surfaces: ["table"],
  yaw: 0,
  camera: {
    view: "side",
  },
  actors: [
    {
      posture: "bent_over_support",
      bodyType: "female",
      wearing: ["top", "shorts"],
      outfit: "sage",
      build: 1,
      stature: 1.66,
      bust: 1,
      jointMode: "fixed",
      placement: {
        position: [0, 0.8607587830793146, -0.49],
        rotation: [85.80000000000001, 0, 0],
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
          flexion: 24,
          abduction: 0,
          rotation: 0,
        },
        head: {
          flexion: 12,
          abduction: 0,
          rotation: 0,
        },
        clavicle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_l: {
          flexion: 142.98240489847922,
          abduction: 53.158409030581346,
          rotation: 71.30228607981677,
        },
        elbow_l: {
          flexion: 85.4900451194048,
          abduction: 0,
          rotation: 0,
        },
        wrist_l: {
          flexion: -37.99225549278238,
          abduction: 34.58238297677067,
          rotation: -15,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 142.99830283185491,
          abduction: 53.0484172237368,
          rotation: 71.35507727550014,
        },
        elbow_r: {
          flexion: 85.68400593861475,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: -37.646121242830816,
          abduction: 34.86441598667711,
          rotation: -15,
        },
        hip_l: {
          flexion: 75.58828320770454,
          abduction: 5.307354695953906,
          rotation: 0.006190059056617922,
        },
        knee_l: {
          flexion: 14.01921569673533,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: -15.243908723774267,
          abduction: -0.06455060300221285,
          rotation: -0.6141699841573154,
        },
        toe_l: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 74.52873867239856,
          abduction: 6.774717126697627,
          rotation: -0.21827833201885763,
        },
        knee_r: {
          flexion: 11.919101687039586,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: -14.164598939703154,
          abduction: -0.08550878147702093,
          rotation: -0.8135896560820103,
        },
        toe_r: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "relaxed",
        r: "relaxed",
      },
    },
    {
      posture: "standing",
      bodyType: "male",
      wearing: ["top", "shorts"],
      outfit: "navy",
      build: 1,
      stature: 1.78,
      bust: 0,
      jointMode: "guided",
      placement: {
        position: [0, 0.91, -0.6961944580078125],
        rotation: [
          5.186407634096824, -0.007848852325061514, -0.0394565491938334,
        ],
        mode: "guided",
      },
      joints: {
        spine01: {
          flexion: 3.94286807523463,
          abduction: -0.21452339226229267,
          rotation: -1.0619206283964235,
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
          flexion: -20,
          abduction: 0,
          rotation: 0,
        },
        head: {
          flexion: -8,
          abduction: 0,
          rotation: 0,
        },
        clavicle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_l: {
          flexion: -15.129113368573725,
          abduction: 14.63919202232418,
          rotation: 13.581855784129434,
        },
        elbow_l: {
          flexion: 69.31234175351115,
          abduction: 0,
          rotation: 0,
        },
        wrist_l: {
          flexion: -6,
          abduction: 0,
          rotation: 0,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: -13.755933591187647,
          abduction: 14.965611397497486,
          rotation: 15.913315831970822,
        },
        elbow_r: {
          flexion: 68.64667396213508,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: -6,
          abduction: 0,
          rotation: 0,
        },
        hip_l: {
          flexion: 11.564212102071282,
          abduction: 23.32718083490441,
          rotation: -43.20190620733588,
        },
        knee_l: {
          flexion: 16.685764699574325,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 8.724474957053955,
          abduction: -9.308805039458555,
          rotation: 20,
        },
        toe_l: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 11.069972394474437,
          abduction: 22.781005358121792,
          rotation: -43.34582916684082,
        },
        knee_r: {
          flexion: 15.426319355394297,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 8.397774400277534,
          abduction: -8.632374554214184,
          rotation: 20,
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
