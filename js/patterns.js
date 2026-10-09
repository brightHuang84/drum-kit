// Beginner patterns, easiest first. Each bar is 16 steps: 1 e & a, 2 e & a, 3 e & a, 4 e & a.
// A step is a list of drum ids (see PIECES in kit.js). Add a lesson by pushing another object.

const STEPS = 16;

function grid(bars, hits) {
  const steps = Array.from({ length: bars * STEPS }, () => []);
  for (const [index, ...drums] of hits) steps[index].push(...drums);
  return steps;
}

const hh8 = [0, 2, 4, 6, 8, 10, 12, 14];
const hh16 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function hats(id, at) {
  return at.map((step) => [step, id]);
}

export const PATTERNS = [
  {
    id: "quarters",
    title: "四分底鼓和军鼓",
    tip: "一拍和三拍踩底鼓，二拍和四拍打军鼓。F 和 G 轮流按。",
    steps: grid(1, [
      [0, "kick"],
      [4, "snare"],
      [8, "kick"],
      [12, "snare"],
    ]),
  },
  {
    id: "rock-8",
    title: "八分摇滚",
    tip: "闭镲打每一拍的正拍和反拍。底鼓在一和三，军鼓在二和四。",
    steps: grid(1, [
      ...hats("hhClosed", hh8),
      [0, "kick"],
      [4, "snare"],
      [8, "kick"],
      [12, "snare"],
    ]),
  },
  {
    id: "rock-kick",
    title: "底鼓有变化",
    tip: "还是八分摇滚，但第二拍的反拍多踩一下底鼓。",
    steps: grid(1, [
      ...hats("hhClosed", hh8),
      [0, "kick"],
      [4, "snare"],
      [6, "kick"],
      [8, "kick"],
      [12, "snare"],
    ]),
  },
  {
    id: "four-floor",
    title: "四踩迪斯科",
    tip: "每一拍都踩底鼓。闭镲打八分，军鼓仍在二和四。",
    steps: grid(1, [
      ...hats("hhClosed", hh8),
      [0, "kick"],
      [4, "kick"],
      [4, "snare"],
      [8, "kick"],
      [12, "kick"],
      [12, "snare"],
    ]),
  },
  {
    id: "fill",
    title: "简单加花",
    tip: "第一小节照着八分摇滚打。第二小节后一半，军鼓走到嗵鼓。",
    steps: grid(2, [
      ...hats("hhClosed", hh8),
      ...hats("hhClosed", [16, 18, 20, 22]),
      [0, "kick"],
      [4, "snare"],
      [8, "kick"],
      [12, "snare"],
      [16, "kick"],
      [20, "snare"],
      [24, "snare"],
      [26, "tomHigh"],
      [28, "tomMid"],
      [30, "tomFloor"],
    ]),
  },
  {
    id: "open-hat",
    title: "开镲一下",
    tip: "八分摇滚里，把第四拍的反拍改成开镲。",
    steps: grid(1, [
      ...hats("hhClosed", [0, 2, 4, 6, 8, 10, 12]),
      [14, "hhOpen"],
      [0, "kick"],
      [4, "snare"],
      [8, "kick"],
      [12, "snare"],
    ]),
  },
  {
    id: "hats-16",
    title: "十六分闭镲",
    tip: "闭镲换成每拍四下，手轻一点。底鼓和军鼓的位置不变。",
    steps: grid(1, [
      ...hats("hhClosed", hh16),
      [0, "kick"],
      [4, "snare"],
      [8, "kick"],
      [12, "snare"],
    ]),
  },
  {
    id: "tom-around",
    title: "绕嗵鼓",
    tip: "从高嗵走到落地嗵，每拍两下，最后两下回到军鼓。",
    steps: grid(1, [
      [0, "kick"],
      [0, "tomHigh"],
      [2, "tomHigh"],
      [4, "tomMid"],
      [6, "tomMid"],
      [8, "tomFloor"],
      [10, "tomFloor"],
      [12, "snare"],
      [14, "snare"],
    ]),
  },
  {
    id: "ride-8",
    title: "叮叮镲八分",
    tip: "右手改打叮叮镲的八分。底鼓和军鼓不动。",
    steps: grid(1, [
      ...hats("ride", hh8),
      [0, "kick"],
      [4, "snare"],
      [8, "kick"],
      [12, "snare"],
    ]),
  },
  {
    id: "crash-down",
    title: "吊镲起拍",
    tip: "第一拍吊镲和底鼓一起下，后面回到闭镲的八分摇滚。",
    steps: grid(1, [
      [0, "crash"],
      [0, "kick"],
      ...hats("hhClosed", [2, 4, 6, 8, 10, 12, 14]),
      [4, "snare"],
      [8, "kick"],
      [12, "snare"],
    ]),
  },
];
