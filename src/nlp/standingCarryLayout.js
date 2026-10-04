/** Clothed standing/lifted composition with five authored contacts.
 * Both coarse and complete rendered geometry pass without moving the fixed rigs. */
export const STANDING_CARRY_LAYOUT = {
  referenceHeight: 0,
  surfaces: ["floor", "bed"],
  yaw: 180,
  camera: {
    view: "side",
  },
  actors: [
    {
      posture: "standing",
      bodyType: "male",
      wearing: ["top", "shorts"],
      outfit: "sage",
      build: 1,
      stature: 1.78,
      bust: 0,
      jointMode: "fixed",
      placement: {
        position: [0, 0.9551885501657422, 0],
        rotation: [
          0.18640880805347124, -0.0043801205049658785, -0.03999047755210121,
        ],
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
          flexion: -8,
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
          flexion: 14.86,
          abduction: 6.77,
          rotation: 19.75,
        },
        elbow_l: {
          flexion: 36.05,
          abduction: 0,
          rotation: 1,
        },
        wrist_l: {
          flexion: 1.72,
          abduction: -6.45,
          rotation: 2.19,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 15.15,
          abduction: 5.33,
          rotation: 23.2,
        },
        elbow_r: {
          flexion: 35.1,
          abduction: 0,
          rotation: -3.5,
        },
        wrist_r: {
          flexion: 4.13,
          abduction: -7.4,
          rotation: -1.54,
        },
        hip_l: {
          flexion: -0.7037604310245691,
          abduction: 0.39481137897706936,
          rotation: 3.328614924389688,
        },
        knee_l: {
          flexion: 7.519249046796033,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: -3.4686986771728843,
          abduction: -1.8634682522624093,
          rotation: -14.53950241979492,
        },
        toe_l: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: -1.6460203039316443,
          abduction: 1.301641437745091,
          rotation: 2.0822730928202953,
        },
        knee_r: {
          flexion: 5.883937008430796,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: -2.8538292252238455,
          abduction: -1.5923335752233554,
          rotation: -13.343091410624993,
        },
        toe_r: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "hold",
        r: "hold",
      },
    },
    {
      posture: "lifted",
      bodyType: "female",
      wearing: ["top", "shorts"],
      outfit: "navy",
      build: 1,
      stature: 1.66,
      bust: 1,
      jointMode: "fixed",
      placement: {
        position: [
          0.015183891788264554, 0.8888132719857513, 0.24775622662829094,
        ],
        rotation: [
          179.8180470964031, -0.0006372491075471283, 179.96158969182875,
        ],
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
          flexion: 12,
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
          flexion: 0.86,
          abduction: 115.89,
          rotation: -9.55,
        },
        elbow_l: {
          flexion: 117.46,
          abduction: 0,
          rotation: -76,
        },
        wrist_l: {
          flexion: -26.62,
          abduction: 1.69,
          rotation: -4.37,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: -3.47,
          abduction: 115.89,
          rotation: -13.72,
        },
        elbow_r: {
          flexion: 122.28,
          abduction: 0,
          rotation: -80,
        },
        wrist_r: {
          flexion: -32.94,
          abduction: 3.19,
          rotation: -4.87,
        },
        hip_l: {
          flexion: 65,
          abduction: 60,
          rotation: 0,
        },
        knee_l: {
          flexion: 110,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 20,
          abduction: 0,
          rotation: 0,
        },
        toe_l: {
          flexion: 14,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 65,
          abduction: 60,
          rotation: 0,
        },
        knee_r: {
          flexion: 110,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 20,
          abduction: 0,
          rotation: 0,
        },
        toe_r: {
          flexion: 14,
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
