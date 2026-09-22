/** Clothed opposed reclining pair with both original contacts retained.
 * Guided starts are accepted only after complete rendered validation. The
 * shared centering keeps both figures' hands and feet over the finite bed. */
export const HEAD_TO_TOE_LAYOUT = {
  referenceHeight: 0,
  surfaces: ["bed", "floor"],
  yaw: 180,
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
        position: [0, 0.11508745276260013, -0.45],
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
          flexion: -5.643060399013939,
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
          flexion: 10,
          abduction: 130,
          rotation: -19.547671161129067,
        },
        elbow_l: {
          flexion: 1.4450827901727097,
          abduction: 0,
          rotation: -35.38779354870605,
        },
        wrist_l: {
          flexion: -42.53206374552431,
          abduction: -20.059051600564736,
          rotation: -15,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 10,
          abduction: 130,
          rotation: -19.54767113143928,
        },
        elbow_r: {
          flexion: 1.4450827959132075,
          abduction: 0,
          rotation: -63.95181376714468,
        },
        wrist_r: {
          flexion: -46.1955422523609,
          abduction: 0.13607051399977801,
          rotation: 5.630655917109352,
        },
        hip_l: {
          flexion: -1.4554763962610393,
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
          flexion: -1.4554899938249746,
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
        l: "brace",
        r: "brace",
      },
      stature: 1.66,
      bust: 1,
    },
    {
      posture: "prone",
      bodyType: "male",
      wearing: ["top", "shorts"],
      outfit: "navy",
      build: 1,
      jointMode: "guided",
      hands: {
        l: "brace",
        r: "brace",
      },
      joints: {
        spine01: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
        spine02: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
        spine03: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
        neck: {
          flexion: -5.463809967041016,
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
          flexion: 41.37945270844725,
          abduction: 15.907716925721019,
          rotation: -39.66064855627024,
        },
        elbow_l: {
          flexion: 87.50659179667271,
          abduction: 0,
          rotation: 52.033793371612354,
        },
        wrist_l: {
          flexion: 45.74877089594558,
          abduction: 35,
          rotation: 15,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 41.379370709128516,
          abduction: 15.907812045038503,
          rotation: -39.66050809307427,
        },
        elbow_r: {
          flexion: 87.50659179667234,
          abduction: 0,
          rotation: 52.03363868050769,
        },
        wrist_r: {
          flexion: 45.74872405064718,
          abduction: 35,
          rotation: 15,
        },
        hip_l: {
          flexion: 10.67225883840179,
          abduction: 40,
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
          flexion: 10.67226256229393,
          abduction: 40,
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
      placement: {
        position: [0, 0.3442044448852539, 0.14999999999999997],
        rotation: [100.00000000000001, 0, 180],
        mode: "guided",
      },
      stature: 1.78,
      bust: 0,
    },
  ],
};
