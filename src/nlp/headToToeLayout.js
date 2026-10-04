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
          flexion: 10.91,
          abduction: 125.97,
          rotation: -23.31,
        },
        elbow_l: {
          flexion: 1.24,
          abduction: 0,
          rotation: -52.49,
        },
        wrist_l: {
          flexion: 3.7,
          abduction: -4.71,
          rotation: -5.7,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 9.91,
          abduction: 127.96,
          rotation: -46.11,
        },
        elbow_r: {
          flexion: 1.26,
          abduction: 0,
          rotation: -39.69,
        },
        wrist_r: {
          flexion: 4.5,
          abduction: -2.31,
          rotation: 3.51,
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
          flexion: 40.9,
          abduction: 15.88,
          rotation: -40,
        },
        elbow_l: {
          flexion: 89.18,
          abduction: 0,
          rotation: 50.88,
        },
        wrist_l: {
          flexion: -34.12,
          abduction: -8.81,
          rotation: -6.5,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 40.9,
          abduction: 15.88,
          rotation: -40,
        },
        elbow_r: {
          flexion: 89.18,
          abduction: 0,
          rotation: 50.88,
        },
        wrist_r: {
          flexion: -34.12,
          abduction: -8.81,
          rotation: -6.5,
        },
        hip_l: {
          flexion: 8.67225883840179,
          abduction: 40,
          rotation: 0,
        },
        knee_l: {
          flexion: 6.9,
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
          flexion: 8.67226256229393,
          abduction: 40,
          rotation: 0,
        },
        knee_r: {
          flexion: 6.9,
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
        position: [0, 0.3362044448852539, 0.14999999999999997],
        rotation: [100.6, 0, 180],
        mode: "guided",
      },
      stature: 1.78,
      bust: 0,
    },
  ],
};
