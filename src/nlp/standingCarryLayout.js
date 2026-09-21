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
          flexion: 14.86483580580967,
          abduction: 5.765437876573465,
          rotation: 19.75222674647315,
        },
        elbow_l: {
          flexion: 36.049703854693455,
          abduction: 0,
          rotation: 0,
        },
        wrist_l: {
          flexion: -3.4473467975044736,
          abduction: -1.721025608230423,
          rotation: 2.1882835659582835,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 15.153942170724543,
          abduction: 5.330848757144369,
          rotation: 23.20340969806347,
        },
        elbow_r: {
          flexion: 35.10386745501227,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: -2.896311246039294,
          abduction: 0.3663826442697947,
          rotation: -0.5416152942216336,
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
          flexion: 2.302777600942312,
          abduction: 112.11259993269069,
          rotation: -6.952109199754434,
        },
        elbow_l: {
          flexion: 116.70832855292868,
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
          flexion: -1.659449549544485,
          abduction: 114.32393086667582,
          rotation: -11.60002214809087,
        },
        elbow_r: {
          flexion: 120.01575757065851,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
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
