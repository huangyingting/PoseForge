/**
 * The vocabulary the parser matches against.
 *
 * Every entry maps a phrase somebody might actually type onto a value in the
 * pose library. This is a table rather than a grammar on purpose: descriptions
 * of how two people are arranged are overwhelmingly a bag of noun phrases
 * ("she's on her back, he's kneeling between her legs, hands on her hips") and
 * a table gets those right while a grammar spends its effort on the sentence
 * structure that carries almost none of the meaning.
 *
 * The phrases are matched as substrings of the normalised description, longest
 * first, with each match consuming its span. That one rule handles English and
 * Chinese identically - Chinese has no spaces to tokenise on, and substring
 * matching does not care. What it does need is the word-boundary check in the
 * matcher, so that "hip" does not match inside "ship"; CJK is exempt because
 * the concept does not apply.
 *
 * Longest-first is what makes overlapping entries safe. "on her back" means
 * supine and "hand on her back" means a contact with the back, and both can sit
 * in the table without either having to know about the other.
 */

/** @typedef {{phrase:string, kind:string, value:any, actor?:number}} Entry */

const entries = [];
const add = (kind, value, phrases, extra = {}) => {
  for (const phrase of phrases) entries.push({ phrase, kind, value, ...extra });
};

// ---------------------------------------------------------------------------
// Postures
//
// The phrasing that gives away a posture is almost always about what is holding
// the body up - "on her back", "on all fours", "kneeling" - which is exactly
// what the posture archetypes are indexed by.
// ---------------------------------------------------------------------------

add("posture", "standing", [
  "standing", "stands", "stand up", "standing up", "upright", "on her feet",
  "on his feet", "站", "站着", "站立", "直立",
]);
add("posture", "standing_bent_forward", [
  "bent forward", "bending forward", "bent over", "bending over", "leaning forward",
  "bent at the waist", "前倾", "弯腰", "俯身",
]);
add("posture", "bent_over_support", [
  "bent over the bed", "bent over the table", "bent over a table", "bent over the edge",
  "leaning on the bed", "leaning over the table", "hands on the bed", "hands on the table",
  "趴在床边", "扶着床", "扶着桌子",
]);
add("posture", "supine", [
  "on her back", "on his back", "on their back", "lying on her back", "lying on his back",
  "lying back", "lies back", "supine", "face up", "faceup", "facing up", "back on the bed",
  "仰卧", "仰躺", "平躺", "躺着", "仰面",
]);
add("posture", "supine_legs_raised", [
  "legs raised", "legs up", "legs in the air", "knees to her chest", "knees to his chest",
  "ankles up", "双腿抬起", "腿举起",
]);
// The pronoun in these names the *other* person - "sitting on his lap" is a
// sentence about her. Everywhere else a pronoun inside a posture phrase is
// reflexive ("on her back"), and reading these the same way puts the posture on
// the wrong body and then hangs every following phrase off the wrong subject.
add(
  "posture",
  "supine_legs_raised",
  ["legs over his shoulders", "legs over her shoulders", "腿架在肩上"],
  // The person whose shoulders they are is the one *above*, not the one being
  // arranged around - the opposite of "sitting on his lap", where he is the
  // fixed point.
  { otherRef: true, implies: "over_supine", namedRole: 1 }
);
add("posture", "prone", [
  "on her front", "on his front", "on her stomach", "on his stomach", "on her belly",
  "face down", "facedown", "facing down", "prone", "lying face down",
  "俯卧", "趴着", "趴下", "俯身趴",
]);
add("posture", "side_lying", [
  "on her side", "on his side", "on their side", "lying on her side", "lying on his side",
  "side lying", "sideways on the bed", "侧卧", "侧躺", "侧身躺",
]);
add("posture", "seated", [
  "sitting", "sits", "seated", "sat down", "sitting up", "sitting upright",
  "坐", "坐着", "坐下", "端坐",
]);
add("posture", "seated_reclined", [
  "sitting back", "leaning back", "reclining", "sitting reclined", "propped up",
  "leaning against the headboard", "半躺", "靠坐", "斜靠",
]);
add("posture", "reclined", [
  "reclined", "half lying", "propped on her elbows", "propped on his elbows",
  "leaning back on her hands", "leaning back on his hands", "半躺着", "倚靠",
]);
add("posture", "kneeling", [
  "kneeling", "kneels", "on her knees", "on his knees", "on their knees", "knelt",
  "跪", "跪着", "跪下", "跪姿",
]);
add("posture", "kneeling_low", [
  "sitting on her heels", "sitting on his heels", "kneeling low", "crouching",
  "squatting", "haunches", "跪坐", "蹲", "蹲着",
]);
add("posture", "kneeling_straddle", [
  "straddling", "straddles", "astride", "kneeling over", "knees either side",
  "kneeling astride", "骑跨", "跨坐", "骑在",
]);
add("posture", "seated_straddle", ["sitting astride", "seated astride", "面对面坐着"]);
add(
  "posture",
  "seated_straddle",
  [
    "sitting on his lap", "sitting on her lap", "in his lap", "in her lap",
    "坐在腿上", "坐在大腿上",
  ],
  { otherRef: true, implies: "straddle_lap" }
);
add("posture", "all_fours", [
  "on all fours", "all fours", "hands and knees", "on her hands and knees",
  "on his hands and knees", "doggy", "四肢着地", "跪趴", "手膝着地",
]);
add("posture", "forearms_and_knees", [
  "on her forearms", "on his forearms", "forearms and knees", "elbows and knees",
  "head down", "shoulders down", "手肘着地", "肘膝着地", "趴伏",
]);
add("posture", "inverted", [
  "upside down", "inverted", "shoulders on the floor", "shoulder stand",
  "hips in the air", "倒立", "倒置", "肩部着地",
]);
add("posture", "lifted", [
  "lifted", "being carried", "carried", "held up", "picked up",
  "被抱起", "被举起",
]);
add(
  "posture",
  "lifted",
  ["legs around his waist", "legs around her waist", "腿缠在腰上"],
  { otherRef: true, implies: "supported_lift" }
);

// ---------------------------------------------------------------------------
// Arrangements
//
// How the pair is placed relative to each other. These usually come from a
// single preposition phrase, which is why they can be read independently of the
// postures: "behind her" says nothing about whether either of them is standing.
// ---------------------------------------------------------------------------

add("arrangement", "face_to_face", [
  "face to face", "facing each other", "facing one another", "front to front",
  "chest to chest", "in front of her", "in front of him", "in front of",
  "面对面", "相对", "正面相对", "在前面",
]);
add("arrangement", "rear_alignment", [
  "from behind", "behind her", "behind him", "behind them", "rear entry",
  "back to front", "behind", "from the back",
  "从后面", "后入", "在身后", "身后", "背后", "在后面", "后面",
]);
add("arrangement", "spooning", [
  "spooning", "spoons", "curled behind", "both on their sides", "nestled behind",
  "侧卧后入", "后抱", "侧躺相拥",
]);
add("arrangement", "over_supine", [
  "on top of her", "on top of him", "over her", "over him", "above her", "above him",
  "missionary", "lying on top", "on top", "between her legs", "between his legs",
  "压在身上", "在上面", "覆在身上", "在双腿之间",
]);
add("arrangement", "straddle_lap", [
  "straddling his lap", "straddling her lap", "on his lap", "on her lap",
  "cowgirl on his lap", "坐在他腿上", "跨坐腿上",
]);
add("arrangement", "straddle_supine", [
  "straddling him", "straddling her", "riding him", "riding her", "cowgirl",
  "on top astride", "跨坐在上", "骑乘",
]);
add("arrangement", "side_by_side", [
  "side by side", "next to each other", "beside each other", "alongside",
  "lying together", "并排", "并肩", "相邻躺着",
]);
add("arrangement", "behind_bent_over", [
  "behind her bent over", "behind him bent over", "standing behind her bent",
  "从后面弯腰", "后方俯身",
]);
// The person named in these phrases is the one being carried - the secondary -
// where in every other arrangement the named person is the one being arranged
// *around*. "Behind her" makes her the fixed point; "carrying her" makes her the
// one who moves. Marking the exception is what stops the parser putting the
// carrier in the air.
add(
  "arrangement",
  "supported_lift",
  [
    "holding her up", "holding him up", "holds her up", "holds him up",
    "lifting her", "lifting him", "against the wall",
    "carrying her", "carrying him", "抱起", "托举", "靠墙抱起",
  ],
  { namedRole: 1 }
);
add("arrangement", "head_to_toe", [
  "head to toe", "sixty nine", "69", "head to foot", "opposite directions",
  "头尾相对", "反向",
]);

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

add("surface", "bed", ["on the bed", "in bed", "on a bed", "bed", "mattress", "床", "床上"]);
add("surface", "sofa", ["on the sofa", "on the couch", "sofa", "couch", "沙发"]);
add("surface", "chair", ["on the chair", "chair", "stool", "armchair", "椅子", "凳子"]);
add("surface", "table", ["on the table", "table", "desk", "counter", "桌子", "桌上", "书桌"]);
add("surface", "bench", ["bench", "ottoman", "long chair", "长凳", "长椅"]);
add("surface", "floor", ["on the floor", "floor", "ground", "carpet", "rug", "地上", "地板", "地面"]);

// ---------------------------------------------------------------------------
// Body parts
//
// Only the ones a description is likely to name as touching something. The
// landmark table has more, and they all still work if given directly in a
// scene; these are the ones the language layer knows how to hear.
// ---------------------------------------------------------------------------

add("part", "hand", ["hands", "hand", "palms", "palm", "手", "双手", "手掌"]);
add("part", "mouth", ["mouth", "lips", "kissing", "kisses", "kiss", "嘴", "嘴唇", "亲吻", "吻"]);
add("part", "face", ["face", "cheek", "脸", "面颊"]);
add("part", "head", ["head", "头", "头部"]);
add("part", "chest", ["chest", "breasts", "bust", "bosom", "胸", "胸部", "乳房"]);
add("part", "back", ["back", "背", "背部"]);
add("part", "upperBack", ["upper back", "shoulder blades", "上背", "肩胛"]);
add("part", "lowerBack", ["lower back", "small of her back", "small of his back", "下背", "腰背"]);
add("part", "shoulder", ["shoulders", "shoulder", "肩", "肩膀"]);
add("part", "neck", ["neck", "throat", "脖子", "颈部"]);
add("part", "waist", ["waist", "腰", "腰部"]);
add("part", "abdomen", ["stomach", "belly", "abdomen", "tummy", "腹部", "肚子"]);
add("part", "hip", ["hips", "hip", "臀", "髋", "胯"]);
add("part", "buttocks", ["buttocks", "bottom", "backside", "rear", "臀部", "屁股"]);
add("part", "pelvis", ["pelvis", "骨盆"]);
add("part", "groin", ["groin", "胯下"]);
add("part", "lap", ["lap", "大腿上", "腿上"]);
add("part", "thigh", ["thighs", "thigh", "大腿"]);
add("part", "knee", ["knees", "knee", "膝", "膝盖"]);
add("part", "shin", ["shins", "shin", "calf", "calves", "小腿"]);
add("part", "ankle", ["ankles", "ankle", "脚踝", "踝"]);
add("part", "foot", ["feet", "foot", "脚", "足"]);
add("part", "elbow", ["elbows", "elbow", "手肘", "肘"]);
add("part", "forearm", ["forearms", "forearm", "wrist", "wrists", "前臂", "手腕"]);
add("part", "upperArm", ["upper arm", "arms", "arm", "手臂", "胳膊"]);
add("part", "torso", ["torso", "body", "躯干", "身体"]);

// ---------------------------------------------------------------------------
// Who is being spoken about
//
// Descriptions switch subject constantly and mostly by pronoun. Getting this
// wrong is the single most damaging parse error available: it puts the right
// posture on the wrong person, and the result is a confident render of a pose
// nobody asked for.
// ---------------------------------------------------------------------------

add("ref", "female", [
  "she", "her", "hers", "herself", "the woman", "the girl", "the female",
  "woman", "girl", "lady", "她", "女方", "女人", "女生", "女",
]);
add("ref", "male", [
  "he", "him", "his", "himself", "the man", "the boy", "the male",
  "man", "boy", "guy", "他", "男方", "男人", "男生", "男",
]);
add("ref", "first", ["partner a", "the first", "person a", "person one", "甲", "第一个人"]);
add("ref", "second", ["partner b", "the second", "person b", "person two", "乙", "第二个人"]);
add("ref", "both", [
  "they", "them", "both", "each other", "one another", "the couple", "the pair",
  "他们", "她们", "两人", "双方", "彼此",
]);

// ---------------------------------------------------------------------------
// Sides, and words that place one thing against another
// ---------------------------------------------------------------------------

add("side", "left", ["left", "左"]);
add("side", "right", ["right", "右"]);

// Which way round the second person is. This is a modifier on whatever
// arrangement was found rather than an arrangement of its own - "reverse
// cowgirl" is cowgirl turned around, and duplicating the whole entry to say so
// would mean maintaining two copies of every future fix to it.
add("facing", "away", [
  "facing away", "facing the other way", "turned around", "back to him", "back to her",
  "背对", "背对着", "转过身",
]);
add("facing", "toward", ["facing him", "facing her", "turned to face", "面朝", "转向"]);

add("relation", "on", [
  "resting on", "rests on", "placed on", "on top of", "on to", "onto", "on",
  "against", "pressed against", "pressed to", "touching", "touches", "holding",
  "holds", "grips", "gripping", "cupping", "around", "over",
  "放在", "贴着", "压在", "抵着", "握着", "扶着", "靠在", "在",
]);
add("relation", "to", ["to", "with", "at", "对着", "朝向"]);

// ---------------------------------------------------------------------------
// Body descriptors
// ---------------------------------------------------------------------------

add("build", 0.85, ["slim", "slender", "lean", "petite", "thin", "苗条", "纤细", "瘦"]);
add("build", 1.18, ["heavy", "heavyset", "full figured", "curvy", "stocky", "丰满", "壮", "魁梧"]);
add("build", 1.0, ["average build", "medium build", "普通身材"]);
add("stature", "tall", ["tall", "taller", "高", "高个"]);
add("stature", "short", ["short", "shorter", "petite", "矮", "矮个"]);

// ---------------------------------------------------------------------------
// Words that carry no geometry
//
// Listed so the parser can tell "I ignored a word because it means nothing"
// from "I ignored a word because I did not understand it". Only the second is
// worth telling the user about, and a report full of the first is a report
// nobody reads.
// ---------------------------------------------------------------------------

export const FILLER = new Set([
  "a", "an", "the", "is", "are", "was", "were", "being", "be", "and", "or", "but",
  "while", "as", "of", "in", "into", "at", "by", "for", "from", "so", "that",
  "this", "these", "those", "there", "here", "then", "with", "without", "very",
  "quite", "slightly", "gently", "softly", "firmly", "slowly", "together",
  "each", "other", "one", "two", "her", "his", "their", "its", "him", "she",
  "he", "they", "them", "it", "position", "pose", "posture", "sex", "scene",
  "up", "down", "against", "around", "between", "onto", "lying", "lies",
  "couple", "partner", "partners", "person", "people", "man", "woman",
  "的", "了", "着", "在", "和", "与", "一个", "两个", "姿势", "体位", "正在",
]);

/** Everything the matcher scans, longest phrase first. */
export const LEXICON = entries.sort((a, b) => b.phrase.length - a.phrase.length);

/** Grouped lookup, for the UI to offer what it understands. */
export const VOCABULARY = entries.reduce((out, entry) => {
  (out[entry.kind] ||= new Set()).add(entry.value);
  return out;
}, {});
