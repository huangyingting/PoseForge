/** Clothed seated-partner defaults, independently fitted to chair and bench.
 * Coarse body estimates remain distinct from verified rendered clearance. */
export const CHAIR_LAP_LAYOUT = {
  referenceHeight: 0.46,
  surfaces: ["chair", "bench"],
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
      jointMode: "guided",
      placement: {
        mode: "guided",
        position: [0, 0.5440469817448221, 0.1],
        rotation: [0, 0, 0],
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
          flexion: 0,
          abduction: 60,
          rotation: 0,
        },
        elbow_l: {
          flexion: 90,
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
          flexion: 0,
          abduction: 60,
          rotation: 0,
        },
        elbow_r: {
          flexion: 90,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        hip_l: {
          flexion: 84.78217032565111,
          abduction: 10.795925067518905,
          rotation: 2.4564660774435416,
        },
        knee_l: {
          flexion: 99.31292158810018,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: -11.201929460368405,
          abduction: 0.8326791627967366,
          rotation: 0.28673581279163357,
        },
        toe_l: {
          flexion: -5,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 84.77833243428067,
          abduction: 11.0109549677865,
          rotation: 2.424556112545879,
        },
        knee_r: {
          flexion: 99.31208531934027,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: -11.212945846634195,
          abduction: 0.8987322287937435,
          rotation: 0.30948521104933774,
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
      stature: 1.78,
      bust: 0,
    },
    {
      posture: "seated_straddle",
      bodyType: "female",
      wearing: ["top", "shorts"],
      outfit: "navy",
      build: 1,
      jointMode: "guided",
      placement: {
        mode: "guided",
        position: [0, 0.716015625, 0.36],
        rotation: [-155, 0, 180],
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
          flexion: -25,
          abduction: 0,
          rotation: 0,
        },
        head: {
          flexion: -7,
          abduction: 0,
          rotation: 0,
        },
        clavicle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_l: {
          flexion: 41.557820109340994,
          abduction: 39.85071791261695,
          rotation: 53.020621063663384,
        },
        elbow_l: {
          flexion: 74.6005257616,
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
          flexion: 38.61468136148563,
          abduction: 41.2294484544375,
          rotation: 50.84837566889753,
        },
        elbow_r: {
          flexion: 77.62731462783444,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: -6,
          abduction: 0,
          rotation: 0,
        },
        hip_l: {
          flexion: 65,
          abduction: 55,
          rotation: 0,
        },
        knee_l: {
          flexion: 110,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: -20,
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
          flexion: 110,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: -20,
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
      stature: 1.66,
      bust: 1,
    },
  ],
  surfaceVariants: {
    bench: {
      referenceHeight: 0.45,
      actors: [
        {
          posture: "seated",
          bodyType: "male",
          wearing: ["top", "shorts"],
          outfit: "sage",
          build: 1,
          jointMode: "guided",
          placement: {
            mode: "guided",
            position: [0, 0.5337459422875008, 0.1],
            rotation: [0, 0, 0],
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
              flexion: 0,
              abduction: 60,
              rotation: 0,
            },
            elbow_l: {
              flexion: 90,
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
              flexion: 0,
              abduction: 60,
              rotation: 0,
            },
            elbow_r: {
              flexion: 90,
              abduction: 0,
              rotation: 0,
            },
            wrist_r: {
              flexion: 0,
              abduction: 0,
              rotation: 0,
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
          stature: 1.78,
          bust: 0,
        },
        {
          posture: "seated_straddle",
          bodyType: "female",
          wearing: ["top", "shorts"],
          outfit: "navy",
          build: 1,
          jointMode: "guided",
          placement: {
            mode: "guided",
            position: [0, 0.7106950542926787, 0.36],
            rotation: [-155, 0, 180],
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
              flexion: -25,
              abduction: 0,
              rotation: 0,
            },
            head: {
              flexion: -7,
              abduction: 0,
              rotation: 0,
            },
            clavicle_l: {
              flexion: 0,
              abduction: 0,
              rotation: 0,
            },
            shoulder_l: {
              flexion: 41.31132235831022,
              abduction: 40.1109094472394,
              rotation: 53.94365662012722,
            },
            elbow_l: {
              flexion: 74.63962609766128,
              abduction: 0,
              rotation: 0,
            },
            wrist_l: {
              flexion: 0.27980725605718154,
              abduction: 1.042588940634253,
              rotation: -0.28719944872843145,
            },
            clavicle_r: {
              flexion: 0,
              abduction: 0,
              rotation: 0,
            },
            shoulder_r: {
              flexion: 38.35036919776769,
              abduction: 41.48176040359368,
              rotation: 51.73380011352688,
            },
            elbow_r: {
              flexion: 77.63113426118626,
              abduction: 0,
              rotation: 0,
            },
            wrist_r: {
              flexion: -5.685781154372892,
              abduction: 1.0060231299044415,
              rotation: -0.33416299868659444,
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
          stature: 1.66,
          bust: 1,
        },
      ],
    },
  },
};
