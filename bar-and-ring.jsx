import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Home,
  PenSquare,
  History as HistoryIcon,
  Settings as SettingsIcon,
  Plus,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Trash2,
  Dumbbell,
  Pencil,
  Flame,
  BarChart3,
  Bell,
  BellOff,
  Minus,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

/* ───────────────────────── constants ───────────────────────── */

const MAIN_EXERCISES = [
  { name: "Weighted Pull-up", bodyweight: true },
  { name: "Weighted Dip", bodyweight: true },
  { name: "Squat", bodyweight: false },
  { name: "Bench Press", bodyweight: false },
];

const FORMULAS = [
  { id: "lombardi", name: "Lombardi", calc: (g, r) => g * Math.pow(r, 0.1) },
  { id: "brzycki", name: "Brzycki", calc: (g, r) => (r >= 37 ? g * 2 : g * (36 / (37 - r))) },
  { id: "epley", name: "Epley", calc: (g, r) => g * (1 + r / 30) },
  { id: "mayhew", name: "Mayhew", calc: (g, r) => (100 * g) / (52.2 + 41.9 * Math.exp(-0.055 * r)) },
  { id: "oconner", name: "O'Conner", calc: (g, r) => g * (1 + 0.025 * r) },
  { id: "wathan", name: "Wathan", calc: (g, r) => (100 * g) / (48.8 + 53.8 * Math.exp(-0.075 * r)) },
  { id: "lander", name: "Lander", calc: (g, r) => (100 * g) / (101.3 - 2.67123 * r) },
];

const CATEGORIES = [
  {
    id: "strength",
    label: "Strength",
    tagline: "Heavy load · low reps",
    min: 80, max: 95,
    color: "var(--gold)",
    repOptions: [1, 2, 3, 4, 5],
    defaultReps: 4,
    defaultSets: 5,
  },
  {
    id: "endurance",
    label: "Endurance",
    tagline: "Moderate load · moderate reps",
    min: 65, max: 80,
    color: "var(--teal)",
    repOptions: [6, 7, 8, 10, 12],
    defaultReps: 6,
    defaultSets: 4,
  },
  {
    id: "resistance",
    label: "Resistance",
    tagline: "Light load · high reps",
    min: 20, max: 50,
    color: "#a78bfa",
    repOptions: [20, 25, 30, 35, 40],
    defaultReps: 20,
    defaultSets: 3,
  },
];

function categoryMidpoint(cat) {
  return Math.round((cat.min + cat.max) / 2 / 5) * 5;
}

function calc1RM(formulaId, g, r) {
  if (!g || !r) return 0;
  if (formulaId === "average") {
    const vals = FORMULAS.map((f) => f.calc(g, r));
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const f = FORMULAS.find((f) => f.id === formulaId);
  return f ? f.calc(g, r) : g;
}

function repFactor(formulaId, r) { return calc1RM(formulaId, 1, r); }

function roundWeight(w, unit) {
  const inc = unit === "lb" ? 2.5 : 1.25;
  return Math.round(w / inc) * inc;
}

function fmt(n) {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return Math.round(n * 10) / 10;
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function uid() { return Math.random().toString(36).slice(2, 10); }

const KG_TO_LB = 2.20462;
const DEFAULT_REMINDER_DAYS = 3;
const REP_MAX_TABLE_MAX = 7;
const ENDURANCE_TABLE_MAX = 12;

function percentToWeight(pct, oneRM, unit) {
  return Math.max(0, roundWeight(((Number(pct) || 0) * (oneRM || 0)) / 100, unit));
}
function weightToPercent(weight, oneRM) {
  if (!oneRM) return 0;
  return Math.round((Number(weight) || 0) / oneRM * 100);
}

function getRepMaxTable(data, unit, maxReps = REP_MAX_TABLE_MAX, minPercent = null) {
  if (!data || !data.oneRM) return [];
  const rows = [];
  for (let r = 1; r <= maxReps; r++) {
    const factor = repFactor(data.formula, r);
    if (!factor) continue;
    const weight = Math.max(0, roundWeight(data.oneRM / factor, unit));
    const percent = weightToPercent(weight, data.oneRM);
    if (minPercent != null && percent < minPercent) continue;
    rows.push({ reps: r, weight, percent });
  }
  return rows;
}

function getResistanceTable(data, unit, category) {
  if (!data || !data.oneRM) return [];
  const reps = category.repOptions;
  const n = reps.length;
  return reps.map((r, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const percent = Math.round(category.max - t * (category.max - category.min));
    const weight = percentToWeight(percent, data.oneRM, unit);
    return { reps: r, percent, weight };
  });
}

/* ───────────────────────── Peak Goal Planner ───────────────────────── */
// Session-indexed plan: progress is driven by sessions actually logged
// against this goal, not by calendar weeks — so 2x/week and 4x/week
// lifters both get a coherent ramp, just compressed/stretched in time.
// "Week" is kept only as a display/grouping label and to decide when a
// deload or retest checkpoint falls.
//
// Each session's target weight is a %1RM ramp (70% -> 95%) applied to a
// *projected* 1RM that itself climbs linearly from your starting max to
// your target max over the plan — not to your starting max the whole
// way through. Without this, a plan can never actually approach the
// target: 95% of a 70kg starting max is ~66.5kg even in the final
// session, regardless of an 80kg target. Anchoring the ramp on the
// projected max means the final session sits close to the actual goal.
// Retest recalibration (Step 5) keeps this projection honest by
// re-anchoring on your real, tested 1RM every retest cycle instead of
// letting it drift on assumption alone.

const GOAL_DEFAULTS = {
  startPercent: 70,
  peakPercent: 95,
  retestEveryWeeks: 5,
};
const DEFAULT_SESSIONS_PER_WEEK = 3;

// Load-to-bodyweight ratio thresholds for auto-detecting training level.
// Bodyweight lifts (dip/pull-up): (bodyweight + oneRM) / bodyweight.
// Barbell lifts (squat/bench): oneRM / bodyweight.
const LEVEL_THRESHOLDS = {
  bodyweight: { novice: 1.25, intermediate: 1.75 },
  barbell:    { novice: 1.0,  intermediate: 1.5  },
};

// Weekly %1RM gain ceiling per level — midpoints of published ranges.
const WEEKLY_GAIN_CAP_BY_LEVEL = { novice: 1.75, intermediate: 1.0, advanced: 0.4 };

function loadRatio(oneRM, bodyweight, isBodyweight) {
  if (!bodyweight) return null;
  return isBodyweight ? (bodyweight + oneRM) / bodyweight : oneRM / bodyweight;
}

function detectLevel(oneRM, bodyweight, isBodyweight) {
  const ratio = loadRatio(oneRM, bodyweight, isBodyweight);
  if (ratio == null) return null;
  const t = isBodyweight ? LEVEL_THRESHOLDS.bodyweight : LEVEL_THRESHOLDS.barbell;
  if (ratio < t.novice) return "novice";
  if (ratio < t.intermediate) return "intermediate";
  return "advanced";
}

function weeklyCapForLevel(level) {
  return WEEKLY_GAIN_CAP_BY_LEVEL[level] || WEEKLY_GAIN_CAP_BY_LEVEL.intermediate;
}

// Prilepin's Table: real, published %1RM -> reps-per-set / optimal-total-reps
// chart used across strength periodization. Zone boundaries are inclusive on
// the low end per the standard table.
function prilepinZone(pct) {
  if (pct < 70) return { repsRange: [3, 6], totalRange: [18, 30] };
  if (pct < 80) return { repsRange: [3, 6], totalRange: [12, 24] };
  if (pct < 90) return { repsRange: [2, 4], totalRange: [10, 20] };
  return { repsRange: [1, 2], totalRange: [4, 10] };
}
function midpoint([a, b]) { return Math.round((a + b) / 2); }

// Step 1 — realism check: how many weeks does the requested gain actually
// need at a safe weekly %1RM improvement rate? Never silently accept an
// unrealistic goal — the caller always compares this against what the user
// asked for and shows the difference.
function computeEffectiveWeeks(startingOneRM, targetOneRM, targetWeeks, weeklyGainCapPct) {
  if (!startingOneRM) return Math.max(1, targetWeeks);
  const requiredGainPct = ((targetOneRM - startingOneRM) / startingOneRM) * 100;
  if (requiredGainPct <= 0) return Math.max(1, targetWeeks);
  const minWeeksNeeded = Math.ceil(requiredGainPct / weeklyGainCapPct);
  return Math.max(targetWeeks, minWeeksNeeded, 1);
}

function totalSessionsFor(effectiveWeeks, sessionsPerWeek) {
  return Math.max(1, Math.round(effectiveWeeks * sessionsPerWeek));
}
function weekOfSession(session, sessionsPerWeek) {
  return Math.ceil(session / sessionsPerWeek);
}
function isLastSessionOfWeek(session, sessionsPerWeek) {
  return session % sessionsPerWeek === 0;
}

// The 1RM this plan is "aiming from" at a given session — climbs linearly
// from startingOneRM to targetOneRM as session goes from 0 to totalSessions,
// so the ramp is always chasing the actual goal instead of stalling at a
// fixed % of the max you had on day one.
function projectedOneRM(session, totalSessions, startingOneRM, targetOneRM) {
  const t = totalSessions > 0 ? session / totalSessions : 1;
  return startingOneRM + (targetOneRM - startingOneRM) * Math.min(1, t);
}

// Single session row: %1RM ramp (against the projected max) -> Prilepin
// volume -> deload for every 4th week's sessions (half volume, -10 points).
function generateSessionRow(session, totalSessions, sessionsPerWeek, startingOneRM, targetOneRM, unit, startPercent, peakPercent, retestEveryWeeks) {
  const projMax = projectedOneRM(session, totalSessions, startingOneRM, targetOneRM);
  let pct = startPercent + (peakPercent - startPercent) * (totalSessions > 0 ? session / totalSessions : 1);
  const zone = prilepinZone(pct);
  const repsPerSet = midpoint(zone.repsRange);
  const totalReps = midpoint(zone.totalRange);
  let sets = Math.max(1, Math.round(totalReps / repsPerSet));
  let weight = percentToWeight(pct, projMax, unit);
  const week = weekOfSession(session, sessionsPerWeek);
  const finalWeek = weekOfSession(totalSessions, sessionsPerWeek);
  const isDeload = week % 4 === 0 && week !== finalWeek;
  if (isDeload) {
    sets = Math.max(1, Math.round(sets * 0.5));
    pct -= 10;
    weight = percentToWeight(pct, projMax, unit);
  }
  const retestDue = isLastSessionOfWeek(session, sessionsPerWeek) && week % retestEveryWeeks === 0;
  return {
    session,
    week,
    percent: Math.round(pct),
    weight,
    sets,
    repsPerSet,
    isDeload,
    retestDue,
    done: false,
  };
}

function generateGoalSessions(totalSessions, sessionsPerWeek, startingOneRM, targetOneRM, unit, startPercent, peakPercent, retestEveryWeeks, fromSession = 1) {
  const rows = [];
  for (let s = fromSession; s <= totalSessions; s++) {
    rows.push(generateSessionRow(s, totalSessions, sessionsPerWeek, startingOneRM, targetOneRM, unit, startPercent, peakPercent, retestEveryWeeks));
  }
  return rows;
}

// Builds a brand-new goal plan (Goal Setup screen "Save").
function buildGoalPlan({ targetOneRM, startingOneRM, targetWeeks, sessionsPerWeek, unit, bodyweight, isBodyweight, manualLevel, safePace }) {
  const { startPercent, peakPercent, retestEveryWeeks } = GOAL_DEFAULTS;
  const spw = Math.max(1, Number(sessionsPerWeek) || DEFAULT_SESSIONS_PER_WEEK);
  const detected = detectLevel(startingOneRM, bodyweight, isBodyweight);
  const level = detected || manualLevel || "intermediate";
  const levelSource = detected ? "auto" : "manual";
  const weeklyGainCapPct = weeklyCapForLevel(level);
  const requestedWeeks = Math.max(1, Number(targetWeeks) || 1);
  const effectiveWeeks = safePace
    ? computeEffectiveWeeks(startingOneRM, targetOneRM, requestedWeeks, weeklyGainCapPct)
    : requestedWeeks;
  const totalSessions = totalSessionsFor(effectiveWeeks, spw);
  const plan = generateGoalSessions(totalSessions, spw, startingOneRM, targetOneRM, unit, startPercent, peakPercent, retestEveryWeeks, 1);
  return {
    active: true,
    targetOneRM,
    startingOneRM,
    startDate: todayStr(),
    targetWeeks: requestedWeeks,
    sessionsPerWeek: spw,
    effectiveWeeks,
    totalSessions,
    startPercent,
    peakPercent,
    weeklyGainCapPct,
    retestEveryWeeks,
    level,
    levelSource,
    safePace: !!safePace,
    plan,
    lastRetestDate: null,
  };
}

// Current session = number of completed plan rows + 1, capped at the
// plan length. Driven entirely by sessions actually logged against this
// goal — not by elapsed calendar time — so training more or less often
// than planned just compresses or stretches the calendar, not the plan.
function getGoalCurrentSession(goal) {
  if (!goal) return 1;
  const completed = goal.plan.filter((r) => r.done).length;
  return Math.min(goal.totalSessions, completed + 1);
}

// Step 5 — retest recalibration: past sessions are history and are never
// touched. Only sessions after the current one are regenerated, re-anchored
// on the new 1RM as the new "starting" point of the projection toward the
// same target, and Step 1's realism check is re-run against the *remaining*
// horizon so the plan can push its end date out again if needed.
function recalibrateGoalFromRetest(goal, newOneRM, unit, testDate, bodyweight, isBodyweight) {
  if (!goal || !goal.active) return goal;
  const currentSession = getGoalCurrentSession(goal);
  const sessionsPerWeek = goal.sessionsPerWeek || DEFAULT_SESSIONS_PER_WEEK;
  const currentWeek = weekOfSession(currentSession, sessionsPerWeek);
  const remainingWeeksRequested = Math.max(1, goal.effectiveWeeks - currentWeek + 1);

  const detected = detectLevel(newOneRM, bodyweight, isBodyweight);
  const level = detected || goal.level || "intermediate";
  const levelSource = detected ? "auto" : (goal.levelSource || "manual");
  const weeklyGainCapPct = weeklyCapForLevel(level);

  let newRemainingWeeks = remainingWeeksRequested;
  if (goal.safePace) {
    const requiredGainPct = newOneRM ? ((goal.targetOneRM - newOneRM) / newOneRM) * 100 : 0;
    const minWeeksNeeded = requiredGainPct > 0 ? Math.ceil(requiredGainPct / weeklyGainCapPct) : 1;
    newRemainingWeeks = Math.max(remainingWeeksRequested, minWeeksNeeded, 1);
  }
  const newEffectiveWeeks = currentWeek - 1 + newRemainingWeeks;
  const newTotalSessions = totalSessionsFor(newEffectiveWeeks, sessionsPerWeek);

  const pastPlan = goal.plan.filter((r) => r.session < currentSession);
  const futurePlan = generateGoalSessions(
    newTotalSessions, sessionsPerWeek, newOneRM, goal.targetOneRM, unit, goal.startPercent, goal.peakPercent, goal.retestEveryWeeks, currentSession
  ).map((r) => ({ ...r, recalculatedFrom: testDate }));

  return {
    ...goal,
    effectiveWeeks: newEffectiveWeeks,
    totalSessions: newTotalSessions,
    weeklyGainCapPct,
    level,
    levelSource,
    plan: [...pastPlan, ...futurePlan],
    lastRetestDate: testDate,
  };
}

/* ───────────────────────── per-exercise warmup programs ───────────────────────── */

const EXERCISE_WARMUP_PROGRAMS = {
  "Weighted Pull-up": {
    mobility: [
      { label: "Arm circles", detail: "10 reps each direction — warm up shoulder joint & rotator cuff" },
      { label: "Band pull-aparts", detail: "2 × 12 reps — activate upper back & rear delts" },
      { label: "Dead hang", detail: "2 × 20–30 sec — decompress spine, open lats" },
      { label: "Scapular pull-ups", detail: "2 × 8 reps — prime scapular retractors before adding weight" },
    ],
    getRampSets: (targetAdded, unit) => [
      { label: "Bodyweight", weight: 0, reps: 5, note: "Full ROM, controlled descent" },
      { label: "1/3 load", weight: Math.max(0, roundWeight(targetAdded / 3, unit)), reps: 3, note: "Belt on, groove the pattern" },
      { label: "2/3 load", weight: Math.max(0, roundWeight((targetAdded * 2) / 3, unit)), reps: 1, note: "Primer — rest 2–3 min then work sets" },
    ],
  },
  "Weighted Dip": {
    mobility: [
      { label: "Arm circles", detail: "10 reps each direction — loosen shoulder capsule" },
      { label: "Chest stretch (doorway)", detail: "2 × 15 sec each side — open pecs & anterior shoulder" },
      { label: "Tricep overhead stretch", detail: "2 × 15 sec each side — loosen elbow & long head tricep" },
      { label: "Scapular dips (bodyweight)", detail: "2 × 8 reps — activate dip stabilisers before loading" },
    ],
    getRampSets: (targetAdded, unit) => [
      { label: "Bodyweight", weight: 0, reps: 5, note: "Full ROM, stay upright — elbows back not flared" },
      { label: "1/3 load", weight: Math.max(0, roundWeight(targetAdded / 3, unit)), reps: 3, note: "Belt on, control the descent" },
      { label: "2/3 load", weight: Math.max(0, roundWeight((targetAdded * 2) / 3, unit)), reps: 1, note: "Primer — rest 2–3 min then work sets" },
    ],
  },
  "Squat": {
    mobility: [
      { label: "Hip circles & leg swings", detail: "10 reps each direction — open hip joint" },
      { label: "Deep bodyweight squat hold", detail: "2 × 30 sec — establish bottom position, drive knees out" },
      { label: "Ankle mobility wall drill", detail: "10 reps each side — improve dorsiflexion for depth" },
      { label: "Glute bridges", detail: "2 × 10 reps — activate glutes & posterior chain before loading" },
    ],
    getRampSets: (targetWeight, unit) => {
      const bar = unit === "lb" ? 45 : 20;
      return [
        { label: "Empty bar", weight: bar, reps: 5, note: "Slow descent, pause at bottom — groove the pattern" },
        { label: "40%", weight: Math.max(bar, roundWeight(targetWeight * 0.4, unit)), reps: 5, note: "Stay tight, brace the core" },
        { label: "60%", weight: Math.max(bar, roundWeight(targetWeight * 0.6, unit)), reps: 3, note: "" },
        { label: "80%", weight: Math.max(bar, roundWeight(targetWeight * 0.8, unit)), reps: 2, note: "" },
        { label: "90%", weight: Math.max(bar, roundWeight(targetWeight * 0.9, unit)), reps: 1, note: "Rest 2–3 min then work sets" },
      ];
    },
  },
  "Bench Press": {
    mobility: [
      { label: "Arm circles", detail: "10 reps each direction — warm up rotator cuff & shoulder capsule" },
      { label: "Band pull-aparts", detail: "2 × 12 reps — activate upper back & scapular retractors" },
      { label: "Push-ups", detail: "2 × 8 reps — prime chest, triceps & shoulders through full ROM" },
      { label: "Thoracic extension (foam roller)", detail: "10 slow reps — restore upper-back extension for arch setup" },
    ],
    getRampSets: (targetWeight, unit) => {
      const bar = unit === "lb" ? 45 : 20;
      return [
        { label: "Empty bar", weight: bar, reps: 10, note: "Focus on bar path & scapular retraction" },
        { label: "60%", weight: Math.max(bar, roundWeight(targetWeight * 0.6, unit)), reps: 5, note: "" },
        { label: "75%", weight: Math.max(bar, roundWeight(targetWeight * 0.75, unit)), reps: 3, note: "" },
        { label: "90%", weight: Math.max(bar, roundWeight(targetWeight * 0.9, unit)), reps: 1, note: "Rest 2–3 min then work sets" },
      ];
    },
  },
};

const EXERCISE_LIBRARY = {
  main: [
    {
      name: "Weighted Pull-up",
      category: "Back / Pull",
      description: "The core vertical pull for streetlifting. Builds lat, upper back, grip, and bicep strength through a full dead-hang to chin-over-bar range of motion.",
      setsReps: "Strength: 4-5 × 3-5 · Endurance: 3-4 × 6-10 · Resistance: 3 × 20+",
      tips: ["Full dead hang at the bottom of every rep", "Chin clears the bar at the top", "Avoid kipping or swinging"],
      videoUrl: "https://www.youtube.com/watch?v=eGo4IYlbE5g",
    },
    {
      name: "Weighted Dip",
      category: "Chest / Triceps",
      description: "Vertical push for chest, shoulders, and triceps. Depth and control matter more than speed — going too deep too soon is a common shoulder-strain cause.",
      setsReps: "Strength: 4-5 × 3-5 · Endurance: 3-4 × 6-10 · Resistance: 3 × 20+",
      tips: ["Elbows stay back, not flared", "Control the descent — no bouncing at the bottom", "Stop above the point where shoulders roll forward"],
      videoUrl: "https://www.youtube.com/watch?v=2z8JmcrW-As",
    },
    {
      name: "Squat",
      category: "Legs",
      description: "Barbell back squat — the foundation lift for leg and posterior chain strength.",
      setsReps: "Strength: 5 × 3-5 · Endurance: 4 × 6-10 · Resistance: 3 × 20+",
      tips: ["Brace the core before unracking", "Knees track over toes", "Hit consistent depth every rep"],
      videoUrl: "https://www.youtube.com/watch?v=aclHkVaku9U",
    },
    {
      name: "Bench Press",
      category: "Chest / Push",
      description: "Barbell horizontal press for chest, shoulders, and triceps.",
      setsReps: "Strength: 5 × 3-5 · Endurance: 4 × 6-10 · Resistance: 3 × 20+",
      tips: ["Retract shoulder blades before lift-off", "Consistent, controlled bar path", "Feet planted, slight arch, no bouncing off the chest"],
      videoUrl: "https://www.youtube.com/watch?v=gRVjAtPip0Y",
    },
  ],
  accessory: [
    { name: "Australian Row", category: "Back", description: "Horizontal pull under a bar or rings — builds pulling volume and scapular control without loading the spine.", setsReps: "3 × 10-15", tips: ["Body stays rigid, no sagging hips", "Pull chest to the bar"], videoUrl: "https://www.youtube.com/watch?v=1eWj2xn7GCg" },
    { name: "Hollow Body Hold", category: "Core", description: "Foundational gymnastics core position — carries over directly to pull-up and dip control.", setsReps: "3 × 20-40 sec", tips: ["Lower back pressed into the floor", "Keep it small before making it long — sacrifice range for position"], videoUrl: "https://www.youtube.com/watch?v=Q9444r6_Q0k" },
    { name: "L-Sit", category: "Core", description: "Compression and straight-arm strength hold, great for hip flexors and midline control.", setsReps: "4-5 × max hold", tips: ["Push the floor/bars away, don't just sit", "Start with tucked or one-leg variations"], videoUrl: "https://www.youtube.com/watch?v=KbOR1sbVtt4" },
    { name: "Face Pull", category: "Shoulders", description: "Rear delt and rotator cuff work — key for shoulder health under heavy pressing/pulling.", setsReps: "3 × 12-15", tips: ["Pull to face height, elbows high", "Light weight, focus on control"], videoUrl: "https://www.youtube.com/watch?v=rep-qVOkqgk" },
    { name: "Nordic Curl", category: "Legs", description: "Eccentric hamstring strength — strong carryover to squat stability and injury resilience.", setsReps: "3 × 5-8", tips: ["Lower as slowly as controllable", "Use hands to assist back up when needed"], videoUrl: "https://www.youtube.com/watch?v=QnHc6Jz-ZUM" },
    { name: "Hip Thrust", category: "Legs / Glutes", description: "Isolates glute drive, supports squat lockout strength.", setsReps: "3 × 8-12", tips: ["Full lockout at the top, squeeze glutes", "Chin tucked, ribs down"], videoUrl: "https://www.youtube.com/watch?v=LM8XHLYJoYs" },
    { name: "Plank", category: "Core", description: "Anti-extension core stability, supports bracing under load in squat/bench.", setsReps: "3 × 30-60 sec", tips: ["Straight line head to heels", "Don't let hips sag or pike"], videoUrl: "https://www.youtube.com/watch?v=pSHjTRCQxIw" },
    { name: "Band Pull-Apart", category: "Shoulders", description: "High-volume shoulder health and posture work — great as a warm-up or finisher.", setsReps: "3 × 15-20", tips: ["Squeeze shoulder blades at the end range", "Keep arms straight throughout"], videoUrl: "https://www.youtube.com/watch?v=Q50Y2gdyk7Y" },
  ],
};

function getExerciseWarmup(exerciseName, targetWeight, unit, isBodyweight) {
  const prog = EXERCISE_WARMUP_PROGRAMS[exerciseName];
  if (prog) {
    return { mobility: prog.mobility, rampSets: prog.getRampSets(targetWeight, unit) };
  }
  const rampSets = isBodyweight
    ? [
        { label: "Bodyweight", weight: 0, reps: 5, note: "Full ROM" },
        { label: "1/3 load", weight: Math.max(0, roundWeight(targetWeight / 3, unit)), reps: 3, note: "" },
        { label: "2/3 load", weight: Math.max(0, roundWeight((targetWeight * 2) / 3, unit)), reps: 1, note: "Rest 2 min then work sets" },
      ]
    : [
        { label: "50%", weight: Math.max(0, roundWeight(targetWeight * 0.5, unit)), reps: 6, note: "" },
        { label: "65%", weight: Math.max(0, roundWeight(targetWeight * 0.65, unit)), reps: 4, note: "" },
        { label: "80%", weight: Math.max(0, roundWeight(targetWeight * 0.8, unit)), reps: 2, note: "" },
        { label: "90%", weight: Math.max(0, roundWeight(targetWeight * 0.9, unit)), reps: 1, note: "Rest 2 min then work sets" },
      ];
  return { mobility: [], rampSets };
}

/* ───────────────────────── tonnage / streak helpers ───────────────────────── */

function sessionTonnage(session, isBodyweight, bodyweight) {
  const load = isBodyweight ? (session.weightUsed || 0) + (Number(bodyweight) || 0) : session.weightUsed || 0;
  return load * (session.setsCompleted || 0) * (session.repsCompleted || 0);
}

function mondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function shortDateLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function computeWeeklyTonnage(exData, bodyweight, weeks = 8, exerciseFilter = null) {
  const buckets = {};
  const names = exerciseFilter ? [exerciseFilter] : Object.keys(exData);
  for (const name of names) {
    const data = exData[name];
    if (!data) continue;
    for (const s of data.sessions) {
      const key = mondayOf(s.date);
      const t = sessionTonnage(s, data.isBodyweight, bodyweight);
      buckets[key] = (buckets[key] || 0) + t;
    }
  }
  const thisMonday = mondayOf(todayStr());
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const key = addDays(thisMonday, -7 * i);
    out.push({ week: key, label: shortDateLabel(key), value: Math.round((buckets[key] || 0) * 10) / 10 });
  }
  return out;
}

function weeksWithSessions(exData) {
  const set = new Set();
  for (const data of Object.values(exData)) {
    for (const s of data.sessions) set.add(mondayOf(s.date));
  }
  return set;
}

function computeStreak(exData) {
  const weeks = weeksWithSessions(exData);
  if (weeks.size === 0) return { current: 0, best: 0 };
  const thisMonday = mondayOf(todayStr());
  let cursor = weeks.has(thisMonday) ? thisMonday : addDays(thisMonday, -7);
  let current = 0;
  while (weeks.has(cursor)) { current++; cursor = addDays(cursor, -7); }
  const sorted = Array.from(weeks).sort();
  let best = 0, run = 0, prev = null;
  for (const wk of sorted) {
    run = prev && addDays(prev, 7) === wk ? run + 1 : 1;
    best = Math.max(best, run);
    prev = wk;
  }
  return { current, best: Math.max(best, current) };
}

function lastSessionDate(exData) {
  let latest = null;
  for (const data of Object.values(exData)) {
    for (const s of data.sessions) {
      if (!latest || s.date > latest) latest = s.date;
    }
  }
  return latest;
}

function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + "T00:00:00");
  const b = new Date(toStr + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

/* ───────────────────────── storage helpers ───────────────────────── */
// localStorage — persists across page refreshes in the same browser.
// Keys: "bar_ring:config" and "bar_ring:ex:<name>"
// Prefixed to avoid clashing with anything else on the same origin.

function lsGet(key) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : null;
  } catch { return null; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.error("localStorage write failed", key, e); }
}

function lsDel(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

async function loadConfig() {
  return lsGet("bar_ring:config");
}
async function saveConfig(cfg) {
  lsSet("bar_ring:config", cfg);
}
async function loadExercise(name) {
  return lsGet("bar_ring:ex:" + name);
}
async function saveExercise(name, data) {
  lsSet("bar_ring:ex:" + name, data);
}
async function deleteExerciseStorage(name) {
  lsDel("bar_ring:ex:" + name);
}

/* ───────────────────────── styles ───────────────────────── */

const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

    .slf-root {
      --bg: #060606;
      --card: #151310;
      --border: #332e17;
      --text: #f5f1e6;
      --gold: #ffcc00;
      --teal: #e0a526;
      --steel: #a39c85;
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      width: 100%;
      max-width: 480px;
      margin: 0 auto;
      position: relative;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }
    .slf-root * { box-sizing: border-box; }
    .slf-display { font-family: 'Space Grotesk', sans-serif; font-weight: 700; letter-spacing: -0.01em; }
    .slf-mono { font-family: 'Space Mono', monospace; letter-spacing: 0.03em; }

    .slf-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 24px 20px 100px 20px;
    }
    .slf-scroll::-webkit-scrollbar { width: 0; }

    .slf-fade { animation: slf-fadein 0.28s ease both; }
    @keyframes slf-fadein {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .slf-fade { animation: none; }
      .slf-root * { transition: none !important; }
    }

    .slf-card {
      background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 40%), var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.25);
    }
    .slf-btn {
      font-family: 'Inter', sans-serif;
      font-weight: 600;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      transition: transform 0.15s ease, opacity 0.15s ease, background 0.15s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .slf-btn:active { transform: scale(0.97); }
    .slf-btn:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
    .slf-btn-primary {
      background: var(--gold);
      color: #151310;
      padding: 15px 20px;
      font-size: 15px;
    }

    .slf-chip-row {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 2px 2px 6px 2px;
      margin-bottom: 12px;
      scrollbar-width: none;
      -ms-overflow-style: none;
      scroll-snap-type: x proximity;
      -webkit-mask-image: linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent);
      mask-image: linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent);
    }
    .slf-chip-row::-webkit-scrollbar { display: none; }

    .slf-filter-chip {
      white-space: nowrap;
      padding: 9px 17px;
      font-size: 11px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.03);
      color: var(--steel);
      scroll-snap-align: start;
      flex-shrink: 0;
      transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.15s ease;
    }
    .slf-filter-chip:active { transform: scale(0.95); }
    .slf-filter-chip.active {
      background: var(--gold);
      color: #151310;
      border-color: var(--gold);
      box-shadow: 0 4px 16px rgba(255,204,0,0.28);
      font-weight: 700;
    }
    .slf-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
    .slf-btn-ghost {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 13px 18px;
      font-size: 14px;
    }
    .slf-btn-teal {
      background: var(--teal);
      color: #060606;
      padding: 13px 18px;
      font-size: 14px;
    }
    .slf-btn-glass {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.14);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: var(--text);
      padding: 13px 18px;
      font-size: 14px;
    }
    .slf-btn-glass:hover { background: rgba(255,255,255,0.10); }
    .slf-btn-glass:active { background: rgba(255,204,0,0.10); border-color: var(--gold); }
    .slf-input {
      width: 100%;
      background: #060606;
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-family: 'Space Mono', monospace;
      font-size: 18px;
      padding: 14px;
      -webkit-appearance: none;
    }
    .slf-input:focus-visible { outline: 2px solid var(--gold); outline-offset: 1px; }
    .slf-label {
      font-family: 'Space Mono', monospace;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--steel);
      margin-bottom: 6px;
      display: block;
    }
    .slf-navbar {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      background: rgba(21,19,16,0.92);
      backdrop-filter: blur(8px);
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-around;
      padding: 10px 6px calc(10px + env(safe-area-inset-bottom));
      max-width: 480px;
      margin: 0 auto;
    }
    .slf-navitem {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      background: none; border: none; color: var(--steel); cursor: pointer;
      font-family: 'Space Mono', monospace; font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 4px 10px; border-radius: 10px;
      transition: color 0.15s ease;
    }
    .slf-navitem.active { color: var(--gold); }
    .slf-topbar { display: flex; align-items: center; gap: 12px; padding: 20px 20px 0 20px; }
    .slf-back {
      background: none; border: none; color: var(--steel); cursor: pointer;
      display: flex; align-items: center; padding: 4px;
    }
    .gauge-progress { transition: stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1); }
    .slf-chip {
      display: inline-flex; align-items: center; gap: 6px;
      font-family: 'Space Mono', monospace; font-size: 11px;
      padding: 5px 10px; border-radius: 999px; border: 1px solid var(--border);
      color: var(--steel);
    }
    .slf-chip.gold { color: var(--gold); border-color: var(--gold); }
    .slf-chip.teal { color: var(--teal); border-color: var(--teal); }
    .slf-divider { height: 1px; background: var(--border); border: none; margin: 18px 0; }
    .slf-exlist-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px; border-radius: 14px; border: 1px solid var(--border);
      background: var(--card); cursor: pointer; margin-bottom: 10px;
      transition: border-color 0.15s ease, transform 0.15s ease;
    }
    .slf-exlist-item:active { border-color: var(--gold); transform: scale(0.99); }
    .slf-modal-overlay {
      position: absolute; inset: 0; background: rgba(6,6,6,0.75);
      display: flex; align-items: flex-end; z-index: 20;
      max-width: 480px; margin: 0 auto;
    }
    .slf-modal {
      background: var(--card); border: 1px solid var(--border);
      border-radius: 20px 20px 0 0; padding: 22px 20px calc(22px + env(safe-area-inset-bottom));
      width: 100%; max-height: 85vh; overflow-y: auto;
    }
    .slf-heat-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; }
    .slf-heat-col { display: flex; flex-direction: column; gap: 4px; }
    .slf-heat-cell { width: 100%; aspect-ratio: 1; border-radius: 3px; background: var(--border); }
    .slf-heat-cell.trained { background: var(--teal); }
    .slf-heat-cell.today { outline: 1.5px solid var(--gold); outline-offset: 1px; }
    .slf-banner {
      display: flex; align-items: center; gap: 12px;
      border-radius: 14px; border: 1px solid var(--gold);
      background: rgba(255,204,0,0.08); padding: 14px 16px;
      margin-bottom: 16px;
    }
    .slf-hero {
      border-radius: 20px;
      border: 1px solid var(--border);
      background: radial-gradient(120% 140% at 20% -10%, rgba(255,204,0,0.14), transparent 55%), var(--card);
      padding: 30px 20px;
    }
    .slf-stepper-btn {
      width: 44px; height: 44px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      background: transparent; border: 1px solid var(--border); color: var(--text);
      cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease;
    }
    .slf-stepper-btn:active { background: rgba(255,204,0,0.12); border-color: var(--gold); }
    .slf-stepper-btn:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
    .slf-rmtable { width: 100%; border-collapse: collapse; }
    .slf-rmtable th {
      font-family: 'Space Mono', monospace; font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--steel); text-align: left;
      padding: 0 0 10px 0; font-weight: 400;
    }
    .slf-rmtable th:not(:first-child), .slf-rmtable td:not(:first-child) { text-align: right; }
    .slf-rmtable td {
      font-family: 'Space Mono', monospace; font-size: 13px;
      padding: 9px 0; border-top: 1px solid var(--border);
    }
    .slf-rmtable tr.active td { color: var(--gold); font-weight: 700; }

    .slf-section-divider {
      display: flex; align-items: center; gap: 10px; margin: 22px 0 16px;
    }
    .slf-section-divider::before, .slf-section-divider::after {
      content: ''; flex: 1; height: 1px; background: var(--border);
    }

    .slf-cat-glass-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 22px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      cursor: pointer;
      margin-bottom: 12px;
      transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
      text-align: left;
      box-shadow: 0 2px 16px rgba(0,0,0,0.3);
    }
    .slf-cat-glass-btn:active { transform: scale(0.98); }

    .slf-chip-row {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 2px 2px 6px 2px;
      margin-bottom: 12px;
      scrollbar-width: none;
      -ms-overflow-style: none;
      scroll-snap-type: x proximity;
      -webkit-mask-image: linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent);
      mask-image: linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent);
    }
    .slf-chip-row::-webkit-scrollbar { display: none; }

    .slf-filter-chip {
      white-space: nowrap;
      padding: 9px 17px;
      font-size: 11px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.03);
      color: var(--steel);
      scroll-snap-align: start;
      flex-shrink: 0;
      transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.15s ease;
    }
    .slf-filter-chip:active { transform: scale(0.95); }
    .slf-filter-chip.active {
      background: var(--gold);
      color: #151310;
      border-color: var(--gold);
      box-shadow: 0 4px 16px rgba(255,204,0,0.28);
      font-weight: 700;
    }

    .slf-warmup-row {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 10px 0;
      transition: opacity 0.2s ease;
    }
    .slf-warmup-row.done { opacity: 0.38; }
    .slf-check-circle {
      width: 28px; height: 28px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; cursor: pointer;
      border: 1.5px solid var(--border);
      background: transparent;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .slf-check-circle.done { background: var(--teal); border-color: var(--teal); }
  `}</style>
);

/* ───────────────────────── Gauge ───────────────────────── */

function Gauge({ value, max, size = 180, strokeWidth = 14, color = "var(--gold)", trackColor = "var(--border)", centerBig, centerSmall }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = max ? Math.max(0, Math.min(1, value / max)) : 0;
  const offset = circumference * (1 - pct);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
      <circle className="gauge-progress" cx={size/2} cy={size/2} r={radius} fill="none" stroke={color}
        strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`} />
      {centerBig && (
        <text x="50%" y={centerSmall ? "47%" : "53%"} textAnchor="middle" fill="var(--text)"
          fontFamily="Space Grotesk" fontWeight="700" fontSize={size * 0.155}>{centerBig}</text>
      )}
      {centerSmall && (
        <text x="50%" y="65%" textAnchor="middle" fill="var(--steel)"
          fontFamily="Space Mono" fontSize={size * 0.065} letterSpacing="1">{centerSmall}</text>
      )}
    </svg>
  );
}

/* ───────────────────────── shared bits ───────────────────────── */

function TopBar({ title, onBack }) {
  return (
    <div className="slf-topbar">
      {onBack && (
        <button className="slf-back" onClick={onBack} aria-label="Back">
          <ChevronLeft size={22} />
        </button>
      )}
      <h1 className="slf-display" style={{ fontSize: 20 }}>{title}</h1>
    </div>
  );
}

function EmptyState({ icon, title, sub, action, onAction }) {
  return (
    <div className="slf-card slf-fade" style={{ textAlign: "center", padding: "36px 20px" }}>
      <div style={{ color: "var(--steel)", marginBottom: 10 }}>{icon}</div>
      <div className="slf-display" style={{ fontSize: 16, marginBottom: 6 }}>{title}</div>
      <div style={{ color: "var(--steel)", fontSize: 13, marginBottom: 18 }}>{sub}</div>
      {action && <button className="slf-btn slf-btn-primary" onClick={onAction}>{action}</button>}
    </div>
  );
}

function RepMaxTable({ data, bodyweight, unit, activePercent, category }) {
  const rows = useMemo(() => {
    if (category && category.id === "resistance") return getResistanceTable(data, unit, category);
    const minPercent = category ? category.min : null;
    const maxReps = category && category.id === "endurance" ? ENDURANCE_TABLE_MAX : REP_MAX_TABLE_MAX;
    return getRepMaxTable(data, unit, maxReps, minPercent);
  }, [data, unit, category]);

  if (rows.length === 0) return null;

  let activeReps = null;
  if (activePercent != null && rows.length) {
    let best = rows[0];
    for (const r of rows) {
      if (Math.abs(r.percent - activePercent) < Math.abs(best.percent - activePercent)) best = r;
    }
    activeReps = best.reps;
  }

  return (
    <div className="slf-card" style={{ marginBottom: 14 }}>
      <span className="slf-label" style={{ margin: 0, marginBottom: 12, display: "block" }}>
        {category ? `${category.label} load chart` : "Rep max chart"}
      </span>
      <table className="slf-rmtable">
        <thead><tr><th>RM</th><th>%</th><th>Weight</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.reps} className={r.reps === activeReps ? "active" : ""}>
              <td>{r.reps}RM</td>
              <td>{r.percent}%</td>
              <td>{fmt(r.weight)} {unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────── streak / calendar / tonnage ───────────────────────── */

function StreakBadge({ current, best, size = "normal" }) {
  const big = size === "big";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: big ? 14 : 10 }}>
      <div style={{
        width: big ? 56 : 40, height: big ? 56 : 40, borderRadius: "50%",
        background: current > 0 ? "rgba(255,204,0,0.15)" : "var(--card)",
        border: `1px solid ${current > 0 ? "var(--gold)" : "var(--border)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Flame size={big ? 28 : 20} color={current > 0 ? "var(--gold)" : "var(--steel)"} fill={current > 0 ? "var(--gold)" : "none"} />
      </div>
      <div>
        <div className="slf-display" style={{ fontSize: big ? 26 : 18, lineHeight: 1 }}>
          {current} <span style={{ fontSize: big ? 13 : 11, fontFamily: "Space Mono", color: "var(--steel)", fontWeight: 400 }}>wk{current === 1 ? "" : "s"}</span>
        </div>
        <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 2 }}>streak · best {best}</div>
      </div>
    </div>
  );
}

function TrainingCalendar({ exData, weeks = 12 }) {
  const trainedDays = useMemo(() => {
    const set = new Set();
    for (const data of Object.values(exData)) for (const s of data.sessions) set.add(s.date);
    return set;
  }, [exData]);
  const today = todayStr();
  const thisMonday = mondayOf(today);
  const startMonday = addDays(thisMonday, -7 * (weeks - 1));
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const colStart = addDays(startMonday, 7 * w);
    cols.push(Array.from({ length: 7 }, (_, d) => addDays(colStart, d)));
  }
  return (
    <div>
      <div className="slf-heat-grid">
        {cols.map((col, i) => (
          <div className="slf-heat-col" key={i}>
            {col.map((dateStr) => (
              <div key={dateStr}
                className={`slf-heat-cell ${trainedDays.has(dateStr) ? "trained" : ""} ${dateStr === today ? "today" : ""}`}
                style={{ opacity: dateStr > today ? 0.35 : 1 }}
                title={`${dateStr}${trainedDays.has(dateStr) ? " · trained" : ""}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <span className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>{shortDateLabel(startMonday)}</span>
        <span className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>today</span>
      </div>
    </div>
  );
}

function TonnageChart({ exData, bodyweight, unit, exerciseFilter }) {
  const data = useMemo(() => computeWeeklyTonnage(exData, bodyweight, 8, exerciseFilter), [exData, bodyweight, exerciseFilter]);
  const hasAny = data.some((d) => d.value > 0);
  return (
    <div className="slf-card" style={{ height: 190, padding: "16px 8px" }}>
      {!hasAny ? (
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--steel)", fontSize: 13 }}>
          Log a session to see tonnage trend.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#332e17" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke="#a39c85" tick={{ fontSize: 10, fontFamily: "Space Mono" }} />
            <YAxis stroke="#a39c85" tick={{ fontSize: 10, fontFamily: "Space Mono" }} />
            <Tooltip
              contentStyle={{ background: "#151310", border: "1px solid #332e17", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#f5f1e6" }}
              formatter={(v) => [`${fmt(v)} ${unit}`, "tonnage"]}
            />
            <Bar dataKey="value" fill="#e0a526" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function ReminderBanner({ exData, reminderDays, streak }) {
  const last = lastSessionDate(exData);
  if (!last) return null;
  const gap = daysBetween(last, todayStr());
  if (gap < reminderDays) return null;
  return (
    <div className="slf-banner">
      <Flame size={22} color="var(--gold)" />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{gap} {gap === 1 ? "day" : "days"} since your last session</div>
        <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 2 }}>
          {streak.current > 0 ? `Keep the ${streak.current}-week streak alive.` : "Log a session to start a new streak."}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Beep + Rest Timer ───────────────────────── */

function useBeep() {
  const ctxRef = useRef(null);
  return useCallback(() => {
    try {
      if (!ctxRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        ctxRef.current = new AudioCtx();
      }
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      const playTone = (freq, start, dur) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur + 0.05);
      };
      playTone(880, 0, 0.15);
      playTone(1108, 0.18, 0.22);
    } catch (e) { /* audio unavailable */ }
  }, []);
}

function RestTimer({ defaultSeconds = 120, triggerKey }) {
  const [duration, setDuration] = useState(defaultSeconds);
  const [timeLeft, setTimeLeft] = useState(defaultSeconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const beep = useBeep();
  const firstRun = useRef(true);

  useEffect(() => {
    if (!running && !done) { setDuration(defaultSeconds); setTimeLeft(defaultSeconds); }
  }, [defaultSeconds]);

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setTimeLeft(duration); setRunning(true); setDone(false);
  }, [triggerKey]);

  useEffect(() => {
    if (!running) return;
    if (timeLeft <= 0) { setRunning(false); setDone(true); beep(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); return; }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [running, timeLeft, beep]);

  const adjust = (delta) => { setDuration((d) => Math.max(15, d + delta)); if (!running) setTimeLeft((t) => Math.max(0, t + delta)); };
  const start  = () => { setTimeLeft(duration); setRunning(true); setDone(false); };
  const pause  = () => setRunning(false);
  const resume = () => { if (timeLeft > 0) setRunning(true); };
  const reset  = () => { setRunning(false); setTimeLeft(duration); setDone(false); };

  const mm = Math.floor(timeLeft / 60);
  const ss = timeLeft % 60;
  const paused = !running && !done && timeLeft < duration && timeLeft > 0;

  return (
    <div className="slf-card" style={{
      display: "flex", alignItems: "center", gap: 16, marginBottom: 14,
      borderColor: done ? "var(--teal)" : running ? "var(--gold)" : "var(--border)",
      transition: "border-color 0.3s ease",
    }}>
      <Gauge value={duration - timeLeft} max={duration} size={64} strokeWidth={6}
        color={done ? "var(--teal)" : "var(--gold)"}
        centerBig={`${mm}:${String(ss).padStart(2, "0")}`} />
      <div style={{ flex: 1 }}>
        <div className="slf-label" style={{ margin: 0, marginBottom: 8 }}>
          {done ? "Rest done — go!" : running ? "Resting…" : "Rest timer"}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="slf-btn slf-btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => adjust(-15)}>−15s</button>
          <button className="slf-btn slf-btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => adjust(+15)}>+15s</button>
          {!running && !done && !paused && <button className="slf-btn slf-btn-teal" style={{ padding: "6px 12px", fontSize: 11 }} onClick={start}>Start</button>}
          {running && <button className="slf-btn slf-btn-ghost" style={{ padding: "6px 12px", fontSize: 11 }} onClick={pause}>Pause</button>}
          {paused && <button className="slf-btn slf-btn-teal" style={{ padding: "6px 12px", fontSize: 11 }} onClick={resume}>Resume</button>}
          {(done || paused) && <button className="slf-btn slf-btn-glass" style={{ padding: "6px 12px", fontSize: 11 }} onClick={reset}>Reset</button>}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── App ───────────────────────── */

export default function StreetliftingApp() {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState(null);
  const [exData, setExData] = useState({});
  const [screen, setScreen] = useState("welcome");
  const [params, setParams] = useState({});

  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      if (cfg && cfg.onboarded && cfg.exercisesList && cfg.exercisesList.length) {
        const map = {};
        for (const name of cfg.exercisesList) {
          const d = await loadExercise(name);
          if (d) map[name] = d;
        }
        setConfig(cfg); setExData(map); setScreen("dashboard");
      } else {
        setConfig(cfg || { bodyweight: null, unit: "kg", exercisesList: [], onboarded: false });
        setScreen("welcome");
      }
      setReady(true);
    })();
  }, []);

  const nav = useCallback((s, p = {}) => { setParams(p); setScreen(s); }, []);
  const persistConfig = useCallback(async (next) => { setConfig(next); await saveConfig(next); }, []);
  const persistExercise = useCallback(async (name, data) => {
    setExData((prev) => ({ ...prev, [name]: data }));
    await saveExercise(name, data);
  }, []);

  const removeExercise = useCallback(async (name) => {
    await deleteExerciseStorage(name);
    setExData((prev) => { const c = { ...prev }; delete c[name]; return c; });
    const nextList = (config.exercisesList || []).filter((n) => n !== name);
    await persistConfig({ ...config, exercisesList: nextList });
  }, [config, persistConfig]);

  const submitTest = useCallback(async ({ name, isBodyweight, formulaId, weightInput, reps, isNew }) => {
    const g = Number(weightInput);
    const oneRM = calc1RM(formulaId, g, Number(reps));
    const test = { id: uid(), date: todayStr(), weightInput: g, reps: Number(reps), formula: formulaId, result: oneRM };
    let data = exData[name];
    let cfg = config;
    if (isNew || !data) {
      data = { name, isBodyweight, formula: formulaId, oneRM, tests: [test], sessions: [] };
      const nextList = Array.from(new Set([...(cfg.exercisesList || []), name]));
      cfg = { ...cfg, exercisesList: nextList, onboarded: true };
      await persistConfig(cfg);
    } else {
      data = { ...data, formula: formulaId, oneRM, tests: [...data.tests, { ...test }] };
      if (data.goal && data.goal.active) {
        data = { ...data, goal: recalibrateGoalFromRetest(data.goal, oneRM, config.unit, todayStr(), config.bodyweight, isBodyweight) };
      }
    }
    await persistExercise(name, data);
    nav("testResult", { name, result: oneRM, isBodyweight });
  }, [config, exData, persistConfig, persistExercise, nav]);

  const logSession = useCallback(async ({ name, category, percent, weightUsed, setsCompleted, repsCompleted, rpe, notes, goalSession }) => {
    const data = exData[name];
    if (!data) return;
    const session = {
      id: uid(), date: todayStr(), category: category || null,
      percent: percent != null ? Number(percent) : null,
      weightUsed: Number(weightUsed), setsCompleted: Number(setsCompleted),
      repsCompleted: Number(repsCompleted), rpe: rpe === "" ? null : Number(rpe), notes: notes || "",
    };
    let nextData = { ...data, sessions: [...data.sessions, session] };
    if (goalSession != null && nextData.goal && nextData.goal.active) {
      const plan = nextData.goal.plan.map((r) => (r.session === goalSession ? { ...r, done: true } : r));
      nextData = { ...nextData, goal: { ...nextData.goal, plan } };
    }
    await persistExercise(name, nextData);
    nav("exerciseDetail", { name });
  }, [exData, persistExercise, nav]);

  const deleteLogItem = useCallback(async (name, kind, id) => {
    const data = exData[name];
    if (!data) return;
    const key = kind === "test" ? "tests" : "sessions";
    await persistExercise(name, { ...data, [key]: data[key].filter((x) => x.id !== id) });
  }, [exData, persistExercise]);

  const editSession = useCallback(async (name, id, patch) => {
    const data = exData[name];
    if (!data) return;
    await persistExercise(name, { ...data, sessions: data.sessions.map((s) => s.id === id ? { ...s, ...patch } : s) });
  }, [exData, persistExercise]);

  const updateFormulaOverride = useCallback(async (name, formulaId) => {
    const data = exData[name];
    if (!data) return;
    await persistExercise(name, { ...data, formula: formulaId });
  }, [exData, persistExercise]);

  const updateBodyweight   = useCallback(async (bw) => { await persistConfig({ ...config, bodyweight: Number(bw) }); }, [config, persistConfig]);
  const updateReminderDays = useCallback(async (days) => { await persistConfig({ ...config, reminderDays: Math.max(1, Number(days) || DEFAULT_REMINDER_DAYS) }); }, [config, persistConfig]);
  const updateUserName     = useCallback(async (name) => { await persistConfig({ ...config, userName: name }); }, [config, persistConfig]);

  const setNotificationsEnabled = useCallback(async (enabled) => {
    if (enabled && typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
    await persistConfig({ ...config, notificationsEnabled: enabled });
  }, [config, persistConfig]);

  const setGoal = useCallback(async (name, targetOneRM, targetWeeks, manualLevel, sessionsPerWeek, safePace) => {
    const data = exData[name];
    if (!data || !data.oneRM) return;
    const goal = buildGoalPlan({
      targetOneRM, startingOneRM: data.oneRM, targetWeeks, sessionsPerWeek, unit: config.unit,
      bodyweight: config.bodyweight, isBodyweight: data.isBodyweight, manualLevel,
      safePace,
    });
    await persistExercise(name, { ...data, goal });
    nav("weeklyPlan", { name });
  }, [exData, config, persistExercise, nav]);

  const removeGoal = useCallback(async (name) => {
    const data = exData[name];
    if (!data) return;
    await persistExercise(name, { ...data, goal: { ...(data.goal || {}), active: false } });
    nav("exerciseDetail", { name });
  }, [exData, persistExercise, nav]);

  const lastNotifiedRef = useRef(null);
  useEffect(() => {
    if (!config || !config.notificationsEnabled) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const check = () => {
      const last = lastSessionDate(exData);
      if (!last) return;
      const gap = daysBetween(last, todayStr());
      const reminderDays = config.reminderDays || DEFAULT_REMINDER_DAYS;
      if (gap >= reminderDays && lastNotifiedRef.current !== todayStr()) {
        try { new Notification("Bar & Ring", { body: `${gap} days since your last session — you're due.` }); }
        catch (e) { /* fail silently */ }
        lastNotifiedRef.current = todayStr();
      }
    };
    check();
    const id = setInterval(check, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [config, exData]);

  const toggleUnit = useCallback(async () => {
    const nextUnit = config.unit === "kg" ? "lb" : "kg";
    const factor = nextUnit === "lb" ? KG_TO_LB : 1 / KG_TO_LB;
    const nextBodyweight = config.bodyweight ? Math.round(config.bodyweight * factor * 10) / 10 : config.bodyweight;
    await persistConfig({ ...config, unit: nextUnit, bodyweight: nextBodyweight });
    const nextExData = {};
    for (const [name, data] of Object.entries(exData)) {
      const conv = (v) => (v === null || v === undefined ? v : Math.round(v * factor * 100) / 100);
      const next = {
        ...data, oneRM: conv(data.oneRM),
        tests: data.tests.map((t) => ({ ...t, weightInput: conv(t.weightInput), result: conv(t.result) })),
        sessions: data.sessions.map((s) => ({ ...s, weightUsed: conv(s.weightUsed) })),
      };
      nextExData[name] = next;
      await saveExercise(name, next);
    }
    setExData(nextExData);
  }, [config, exData, persistConfig]);

  if (!ready) {
    return (
      <div className="slf-root">
        <GlobalStyle />
        <div className="slf-scroll" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="slf-mono" style={{ color: "var(--steel)" }}>loading…</div>
        </div>
      </div>
    );
  }

  const onboarded = config && config.onboarded && Object.keys(exData).length > 0;

  return (
    <div className="slf-root">
      <GlobalStyle />
      {screen === "welcome" && (
        <Welcome onBegin={async (name) => {
          if (name) await persistConfig({ ...config, userName: name });
          nav("about");
        }}
          onOpenAbout={() => nav("about")}
          onOpenLibrary={() => nav("exerciseLibrary")}
          onOpenSettings={() => nav("settings")} />
      )}
      {screen === "exercisePicker" && (
        <ExercisePicker exData={exData} onBack={onboarded ? () => nav("dashboard") : null}
          onPick={(name, isBodyweight) => nav("formulaPicker", { name, isBodyweight, isNew: true })} />
      )}
      {screen === "formulaPicker" && (
        <FormulaPicker name={params.name} onBack={() => nav("exercisePicker", { isNew: true })}
          onPick={(formulaId) => nav("testInput", { name: params.name, isBodyweight: params.isBodyweight, formulaId, isNew: true })} />
      )}
      {screen === "testInput" && (
        <TestInput name={params.name} isBodyweight={params.isBodyweight} formulaId={params.formulaId}
          isNew={params.isNew} config={config}
          onBack={() => params.isNew ? nav("formulaPicker", { name: params.name }) : nav("exerciseDetail", { name: params.name })}
          onSubmit={submitTest} />
      )}
      {screen === "testResult" && (
        <TestResult name={params.name} result={params.result} unit={config.unit} isBodyweight={params.isBodyweight}
          onContinue={() => nav("exerciseDetail", { name: params.name })}
          onAddAnother={() => nav("exercisePicker", { isNew: true })} />
      )}
      {screen === "dashboard" && (
        <Dashboard config={config} exData={exData}
          onOpenExercise={(name) => nav("exerciseDetail", { name })}
          onAddExercise={() => nav("exercisePicker", { isNew: true })}
          onOpenStats={() => nav("stats")}
          onOpenLibrary={() => nav("exerciseLibrary")}
          onDeleteExercise={removeExercise} />
      )}
      {screen === "exerciseLibrary" && (
        <ExerciseLibrary onBack={() => nav(onboarded ? "dashboard" : "welcome")} />
      )}
      {screen === "exerciseDetail" && (
        <ExerciseDetail name={params.name} data={exData[params.name]} unit={config.unit}
          onBack={() => nav("dashboard")}
          onViewPlan={() => nav("weeklyPlan", { name: params.name })}
          onLogFreeform={() => nav("categoryPicker", { name: params.name })}
          onRetest={() => nav("testInput", { name: params.name, isBodyweight: exData[params.name].isBodyweight, formulaId: exData[params.name].formula, isNew: false })}
          onSetGoal={() => nav("goalSetup", { name: params.name })}
          onDeleteTest={(id) => deleteLogItem(params.name, "test", id)}
          onDeleteSession={(id) => deleteLogItem(params.name, "session", id)}
          onEditSession={(id, patch) => editSession(params.name, id, patch)} />
      )}
      {screen === "logPicker" && (
        <LogPicker exData={exData}
          onPick={(name) => nav("categoryPicker", { name, from: "logPicker" })}
          onOpenPlan={(name) => nav("weeklyPlan", { name })}
          onAddExercise={() => nav("exercisePicker", { isNew: true })} />
      )}
      {screen === "categoryPicker" && (
        <CategoryPicker
          name={params.name} data={exData[params.name]} unit={config.unit}
          onBack={() => params.from === "logPicker" ? nav("logPicker") : nav("exerciseDetail", { name: params.name })}
          onPick={(category) => nav("logSession", { name: params.name, from: params.from, category })}
        />
      )}
      {screen === "logSession" && (
        <LogSession
          name={params.name} data={exData[params.name]}
          unit={config.unit} bodyweight={config.bodyweight}
          category={params.category} from={params.from}
          onBack={() => nav("categoryPicker", { name: params.name, from: params.from })}
          onStartWorkout={(wp) => nav("warmupScreen", { name: params.name, from: params.from, ...wp })}
        />
      )}
      {screen === "goalSetup" && (
        <GoalSetup
          name={params.name} data={exData[params.name]} unit={config.unit} bodyweight={config.bodyweight}
          onBack={() => nav("exerciseDetail", { name: params.name })}
          onSave={(targetOneRM, targetWeeks, manualLevel, sessionsPerWeek, safePace) => setGoal(params.name, targetOneRM, targetWeeks, manualLevel, sessionsPerWeek, safePace)}
          onRemoveGoal={() => removeGoal(params.name)}
        />
      )}
      {screen === "weeklyPlan" && (
        <WeeklyPlan
          name={params.name} data={exData[params.name]} unit={config.unit}
          onBack={() => nav("exerciseDetail", { name: params.name })}
          onEditGoal={() => nav("goalSetup", { name: params.name })}
          onPickSession={(row) => nav("warmupScreen", {
            name: params.name, from: "weeklyPlan",
            category: null, percent: row.percent, weight: row.weight,
            targetSets: row.sets, targetReps: row.repsPerSet, goalSession: row.session,
          })}
        />
      )}
      {screen === "warmupScreen" && (
        <WarmupScreen
          name={params.name} data={exData[params.name]}
          unit={config.unit}
          category={params.category} percent={params.percent}
          weight={params.weight} targetSets={params.targetSets} targetReps={params.targetReps}
          from={params.from}
          onBack={() => params.from === "weeklyPlan"
            ? nav("weeklyPlan", { name: params.name })
            : nav("logSession", { name: params.name, from: params.from, category: params.category })}
          onContinue={() => nav("workoutSession", {
            name: params.name, from: params.from,
            category: params.category, percent: params.percent,
            weight: params.weight, targetSets: params.targetSets, targetReps: params.targetReps,
            goalSession: params.goalSession,
          })}
        />
      )}
      {screen === "workoutSession" && (
        <WorkoutSession
          name={params.name} data={exData[params.name]}
          unit={config.unit} bodyweight={config.bodyweight}
          category={params.category} percent={params.percent}
          weight={params.weight} targetSets={params.targetSets} targetReps={params.targetReps}
          from={params.from} goalSession={params.goalSession}
          onBack={() => nav("warmupScreen", {
            name: params.name, from: params.from,
            category: params.category, percent: params.percent,
            weight: params.weight, targetSets: params.targetSets, targetReps: params.targetReps,
            goalSession: params.goalSession,
          })}
          onSubmit={logSession}
        />
      )}
      {screen === "history" && (
        <HistoryScreen exData={exData} unit={config.unit}
          onDeleteTest={(name, id) => deleteLogItem(name, "test", id)}
          onDeleteSession={(name, id) => deleteLogItem(name, "session", id)}
          onBack={() => nav("stats")} />
      )}
      {screen === "stats" && (
        <StatsScreen exData={exData} unit={config.unit} bodyweight={config.bodyweight}
          onOpenHistory={() => nav("history")} />
      )}
      {screen === "settings" && (
        <SettingsScreen config={config} exData={exData}
          onSaveBodyweight={updateBodyweight} onToggleUnit={toggleUnit}
          onFormulaOverride={updateFormulaOverride} onRemoveExercise={removeExercise}
          onAddExercise={() => nav("exercisePicker", { isNew: true })}
          onSaveReminderDays={updateReminderDays}
          onSetNotificationsEnabled={setNotificationsEnabled}
          onSaveUserName={updateUserName}
          onOpenAbout={() => nav("about")}
          onBack={() => nav(onboarded ? "dashboard" : "welcome")} />
      )}
      {screen === "about" && (
        <AboutScreen
          onBack={() => nav(onboarded ? "dashboard" : "welcome")}
          onStart={() => nav("dashboard")}
        />
      )}
      {onboarded && ["dashboard","exerciseDetail","categoryPicker","logSession","goalSetup","weeklyPlan","warmupScreen","workoutSession","logPicker","history","stats","settings","exerciseLibrary","about"].includes(screen) && (
        <BottomNav screen={screen} onNav={nav} />
      )}
    </div>
  );
}

/* ───────────────────────── Welcome ───────────────────────── */

const WELCOME_SLIDES = [
  {
    id: "slide1",
    title: "Find your 1RM",
    image: new URL("./images.jpg", import.meta.url).href,
    description: "Start by testing a lift to estimate your one-rep max and unlock a personalized plan.",
  },
  {
    id: "slide2",
    title: "Build your peak",
    image: new URL("./images2.jpg", import.meta.url).href,
    description: "Choose a goal, frequency, and safe pace so the plan fits your schedule and progress.",
  },
  {
    id: "slide3",
    title: "Track every workout",
    image: new URL("./images3.jpg", import.meta.url).href,
    description: "Log sessions, follow percentages, and watch your strength improve over time.",
  },
  {
    id: "slide4",
    title: "Ready to begin",
    image: new URL("./images5.jpg", import.meta.url).href,
    description: "Enter your name on the last page, then tap Begin to start your training journey.",
  },
];

function WelcomeIllustration({ src, title }) {
  return (
    <div style={{ width: "100%", borderRadius: 24, overflow: "hidden", boxShadow: "0 28px 60px rgba(0,0,0,0.18)" }}>
      <img src={src} alt={title} style={{ width: "100%", height: 340, objectFit: "cover", display: "block" }} />
    </div>
  );
}

function Welcome({ onBegin, onOpenAbout, onOpenLibrary, onOpenSettings }) {
  const [name, setName] = useState("");
  const [slide, setSlide] = useState(0);
  const current = WELCOME_SLIDES[slide];

  return (
    <div className="slf-fade" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px", textAlign: "center", gap: 22 }}>
      <div className="slf-card" style={{ width: "100%", maxWidth: 460, padding: 22, borderRadius: 28, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <WelcomeIllustration src={current.image} title={current.title} />
        <div style={{ marginTop: 18, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
          <h1 className="slf-display" style={{ fontSize: 30, margin: 0, lineHeight: 1.05 }}>{current.title}</h1>
          <p style={{ color: "var(--steel)", fontSize: 14, lineHeight: 1.7, marginTop: 12 }}>{current.description}</p>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 18 }}>
          {WELCOME_SLIDES.map((item, index) => (
            <button
              key={item.id}
              onClick={() => setSlide(index)}
              className="slf-btn"
              style={{
                width: 12,
                height: 12,
                minWidth: 12,
                padding: 0,
                borderRadius: 999,
                background: slide === index ? "var(--gold)" : "rgba(255,255,255,0.12)",
                border: "none",
              }}
              aria-label={`Go to ${item.title}`}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            className="slf-btn slf-btn-ghost"
            onClick={() => setSlide(Math.max(0, slide - 1))}
            disabled={slide === 0}
            style={{ flex: 1 }}
          >
            Back
          </button>
          <button
            className="slf-btn slf-btn-primary"
            onClick={() => setSlide(Math.min(WELCOME_SLIDES.length - 1, slide + 1))}
            style={{ flex: 1 }}
            disabled={slide === WELCOME_SLIDES.length - 1}
          >
            Next
          </button>
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 12 }}>
        {slide === WELCOME_SLIDES.length - 1 && (
          <>
            <div style={{ width: "100%" }}>
              <span className="slf-label" style={{ textAlign: "left" }}>Your name (optional, for the dashboard)</span>
              <input className="slf-input" style={{ fontFamily: "Inter", fontSize: 15 }} value={name}
                onChange={(e) => setName(e.target.value)} placeholder="e.g. Rayan" />
            </div>
            <button className="slf-btn slf-btn-primary" style={{ width: "100%" }} onClick={() => onBegin(name.trim())}>Begin</button>
          </>
        )}
        <div style={{ display: "flex", gap: 18, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="slf-btn" style={{ background: "none", color: "var(--steel)", fontSize: 12, padding: 6 }} onClick={onOpenAbout}>About</button>
          <button className="slf-btn" style={{ background: "none", color: "var(--steel)", fontSize: 12, padding: 6 }} onClick={onOpenLibrary}>Exercise Library</button>
          <button className="slf-btn" style={{ background: "none", color: "var(--steel)", fontSize: 12, padding: 6 }} onClick={onOpenSettings}>Settings</button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Exercise Picker ───────────────────────── */

function ExercisePicker({ exData, onPick, onBack }) {
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customBW, setCustomBW] = useState(false);
  const remaining = MAIN_EXERCISES.filter((e) => !exData[e.name]);
  const already = MAIN_EXERCISES.filter((e) => exData[e.name]);
  return (
    <div className="slf-fade">
      <TopBar title="Choose a lift" onBack={onBack} />
      <div className="slf-scroll">
        {remaining.map((e) => (
          <div key={e.name} className="slf-exlist-item" onClick={() => onPick(e.name, e.bodyweight)}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{e.name}</div>
              <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 3 }}>
                {e.bodyweight ? "bodyweight + load" : "barbell"}
              </div>
            </div>
            <ChevronRight size={18} color="var(--steel)" />
          </div>
        ))}
        {already.length > 0 && (
          <div style={{ marginTop: 6, marginBottom: 14 }}>
            <span className="slf-label">Already set up</span>
            {already.map((e) => (
              <span key={e.name} className="slf-chip" style={{ marginRight: 8, marginBottom: 8, display: "inline-flex" }}>{e.name}</span>
            ))}
          </div>
        )}
        {!showCustom ? (
          <button className="slf-btn slf-btn-ghost" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}
            onClick={() => setShowCustom(true)}>
            <Plus size={16} /> Add custom exercise
          </button>
        ) : (
          <div className="slf-card" style={{ marginTop: 8 }}>
            <span className="slf-label">Exercise name</span>
            <input className="slf-input" style={{ fontFamily: "Inter", fontSize: 15, marginBottom: 14 }}
              value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Front Lever Row" />
            <span className="slf-label">Load type</span>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[["Barbell / total", false], ["Bodyweight + load", true]].map(([label, bw]) => (
                <button key={label} className="slf-btn" style={{ flex: 1, padding: 12, fontSize: 13,
                  background: customBW === bw ? "var(--gold)" : "transparent",
                  color: customBW === bw ? "#151310" : "var(--text)",
                  border: "1px solid var(--border)" }} onClick={() => setCustomBW(bw)}>{label}</button>
              ))}
            </div>
            <button className="slf-btn slf-btn-primary" style={{ width: "100%" }}
              disabled={!customName.trim()} onClick={() => onPick(customName.trim(), customBW)}>Continue</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Formula Picker ───────────────────────── */

function FormulaPicker({ name, onPick, onBack }) {
  const [selected, setSelected] = useState("average");
  return (
    <div className="slf-fade">
      <TopBar title="1RM formula" onBack={onBack} />
      <div className="slf-scroll">
        <p style={{ color: "var(--steel)", fontSize: 13, marginBottom: 18 }}>
          Choose how <strong style={{ color: "var(--text)" }}>{name}</strong> estimates your one-rep max.
        </p>
        {[{ id: "average", name: "Average of all seven", sub: "recommended" }, ...FORMULAS].map((f) => (
          <div key={f.id} className="slf-card" style={{ marginBottom: 10, border: selected === f.id ? "1px solid var(--gold)" : "1px solid var(--border)", cursor: "pointer" }}
            onClick={() => setSelected(f.id)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{f.name}</div>
                {f.sub && <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 3 }}>{f.sub}</div>}
              </div>
              {selected === f.id && <Check size={18} color="var(--gold)" />}
            </div>
          </div>
        ))}
        <button className="slf-btn slf-btn-primary" style={{ width: "100%", marginTop: 10 }} onClick={() => onPick(selected)}>Continue</button>
      </div>
    </div>
  );
}

/* ───────────────────────── Test Input ───────────────────────── */

function TestInput({ name, isBodyweight, formulaId, isNew, config, onSubmit, onBack }) {
  const [weightInput, setWeightInput] = useState("");
  const [reps, setReps] = useState("");
  const repsNum = Number(reps);
  const repsValid = reps !== "" && repsNum >= 1 && repsNum <= 12;
  const canSubmit = weightInput && repsValid;
  return (
    <div className="slf-fade">
      <TopBar title={isNew ? "New 1RM test" : "Retest 1RM"} onBack={onBack} />
      <div className="slf-scroll">
        <div className="slf-card">
          <div style={{ marginBottom: 16 }}>
            <span className="slf-label">{name}</span>
            <span className="slf-chip gold">{formulaId === "average" ? "average of 7" : FORMULAS.find((f) => f.id === formulaId)?.name}</span>
          </div>
          <span className="slf-label">{isBodyweight ? `Added weight (${config.unit})` : `Weight lifted (${config.unit})`}</span>
          <input className="slf-input" type="number" inputMode="decimal" style={{ marginBottom: 16 }}
            value={weightInput} onChange={(e) => setWeightInput(e.target.value)} placeholder="0" />
          <span className="slf-label">Reps performed</span>
          <input className="slf-input" type="number" inputMode="numeric" value={reps}
            onChange={(e) => setReps(e.target.value)} placeholder="1–12" />
          {reps !== "" && !repsValid && (
            <p style={{ color: "#d16a6a", fontSize: 12, marginTop: 8 }}>Formulas break down outside 1–12 reps.</p>
          )}
          {isBodyweight && (
            <p style={{ color: "var(--steel)", fontSize: 12, marginTop: 12 }}>
              The formula is applied directly to this added weight — your bodyweight isn't part of the 1RM calculation.
            </p>
          )}
          <button className="slf-btn slf-btn-primary" style={{ width: "100%", marginTop: 18 }}
            disabled={!canSubmit}
            onClick={() => onSubmit({ name, isBodyweight, formulaId, weightInput, reps, isNew })}>
            Calculate 1RM
          </button>
        </div>
      </div>
    </div>
  );
}

function TestResult({ name, result, unit, isBodyweight, onContinue, onAddAnother }) {
  return (
    <div className="slf-fade" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center", gap: 20 }}>
      <Gauge value={1} max={1} size={190} strokeWidth={14} color="var(--teal)" centerBig={fmt(result)} centerSmall={unit} />
      <div>
        <div className="slf-mono" style={{ color: "var(--steel)", fontSize: 12, marginBottom: 6 }}>NEW 1RM · {name.toUpperCase()}</div>
        <div className="slf-display" style={{ fontSize: 22 }}>{fmt(result)} {unit}</div>
        {isBodyweight && <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 6 }}>added weight only — bodyweight excluded</div>}
      </div>
      <p style={{ color: "var(--steel)", fontSize: 13, maxWidth: 280 }}>
        Ready to log a session — pick a training category and percentage, or set a weight directly.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        <button className="slf-btn slf-btn-primary" onClick={onContinue}>Go to exercise</button>
        <button className="slf-btn slf-btn-ghost" onClick={onAddAnother}>Set up another lift</button>
      </div>
    </div>
  );
}

/* ───────────────────────── Dashboard ───────────────────────── */

function Dashboard({ config, exData, onOpenExercise, onAddExercise, onOpenStats, onOpenLibrary, onDeleteExercise }) {
  const names = Object.keys(exData);
  const mainNames = MAIN_EXERCISES.map((e) => e.name);
  const mainPresent = mainNames.filter((n) => exData[n]);
  const currentTotal = mainPresent.reduce((sum, n) => sum + (exData[n].oneRM || 0), 0);
  const baselineTotal = mainPresent.reduce((sum, n) => { const t = exData[n].tests; return sum + (t && t[0] ? t[0].result : 0); }, 0);
  const pctChange = baselineTotal > 0 ? ((currentTotal - baselineTotal) / baselineTotal) * 100 : 0;
  const streak = useMemo(() => computeStreak(exData), [exData]);

  if (names.length === 0) {
    return (
      <div className="slf-fade">
        <TopBar title="Dashboard" />
        <div className="slf-scroll">
          <EmptyState icon={<Dumbbell size={32} />} title="No lifts yet" sub="Add your first lift to run a 1RM test."
            action="Add your first lift" onAction={onAddExercise} />
        </div>
      </div>
    );
  }
  return (
    <div className="slf-fade">
      <TopBar title="Dashboard" />
      <div className="slf-scroll">
        {config.userName && <div className="slf-display" style={{ fontSize: 19, marginBottom: 16 }}>Hi {config.userName}, keep going</div>}
        <ReminderBanner exData={exData} reminderDays={config.reminderDays || DEFAULT_REMINDER_DAYS} streak={streak} />
        <div className="slf-card slf-exlist-item" style={{ marginBottom: 16, cursor: "pointer" }} onClick={onOpenStats}>
          <StreakBadge current={streak.current} best={streak.best} />
          <ChevronRight size={18} color="var(--steel)" />
        </div>
        <div className="slf-card slf-exlist-item" style={{ marginBottom: 16, cursor: "pointer" }} onClick={onOpenLibrary}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%", background: "rgba(255,204,0,0.10)",
              border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Dumbbell size={18} color="var(--gold)" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Exercise Library</div>
              <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 2 }}>Programs, cues & tutorials</div>
            </div>
          </div>
          <ChevronRight size={18} color="var(--steel)" />
        </div>
        <div className="slf-hero" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 16px" }}>
          <Gauge value={mainPresent.length} max={4} size={172} strokeWidth={12}
            centerBig={fmt(currentTotal)} centerSmall={`TOTAL · ${config.unit}`} />
          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            {mainPresent.length >= 2 && baselineTotal > 0 && (
              <span className={`slf-chip ${pctChange >= 0 ? "teal" : ""}`}>
                {pctChange >= 0 ? "+" : ""}{fmt(pctChange)}% since first total
              </span>
            )}
            <span className="slf-chip">{mainPresent.length}/4 main lifts tracked</span>
          </div>
        </div>
        <div style={{ marginTop: 24, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="slf-label" style={{ margin: 0 }}>Your lifts</span>
          <button className="slf-btn" style={{ background: "none", color: "var(--gold)", padding: 6, display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
            onClick={onAddExercise}><Plus size={14} /> Add</button>
        </div>
        {names.map((n) => (
          <ExerciseCard key={n} data={exData[n]} unit={config.unit} onClick={() => onOpenExercise(n)} onDelete={() => onDeleteExercise(n)} />
        ))}
      </div>
    </div>
  );
}

function ExerciseCard({ data, unit, onClick, onDelete }) {
  const lastSession = data.sessions.length ? data.sessions[data.sessions.length - 1] : null;
  const goal = data.goal && data.goal.active ? data.goal : null;
  return (
    <div className="slf-exlist-item" style={{ alignItems: "center" }} onClick={onClick}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{data.name}</div>
          {goal && <span className="slf-chip gold"><Flame size={11} />peak</span>}
        </div>
        <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 4 }}>
          {data.sessions.length} session{data.sessions.length === 1 ? "" : "s"} logged
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
          <div>
            <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>1RM</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--gold)" }}>{fmt(data.oneRM)} {unit}</div>
          </div>
          {lastSession && (
            <div>
              <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>LAST SESSION</div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {fmt(lastSession.weightUsed)} {unit}{lastSession.percent != null ? ` · ${lastSession.percent}%` : ""}
              </div>
            </div>
          )}
        </div>
      </div>
      <button className="slf-btn" style={{ background: "none", color: "#d16a6a", padding: 6, flexShrink: 0 }}
        aria-label={`Delete ${data.name}`} onClick={(e) => { e.stopPropagation(); onDelete(); }}>
        <Trash2 size={16} />
      </button>
      <ChevronRight size={18} color="var(--steel)" />
    </div>
  );
}

/* ───────────────────────── Exercise Detail ───────────────────────── */

function ExerciseDetail({ name, data, unit, onBack, onViewPlan, onLogFreeform, onRetest, onSetGoal, onDeleteTest, onDeleteSession, onEditSession }) {
  if (!data) return null;
  const chartData = data.tests.map((t, i) => ({ label: `T${i + 1}`, value: Math.round(t.result * 10) / 10 }));
  const goal = data.goal && data.goal.active ? data.goal : null;
  const currentSession = goal ? getGoalCurrentSession(goal) : null;
  const currentRow = goal ? goal.plan.find((r) => r.session === currentSession) : null;
  const hasTestThisWeek = data.tests.some((t) => mondayOf(t.date) === mondayOf(todayStr()));
  const showRetestBanner = goal && currentRow && currentRow.retestDue && !hasTestThisWeek;

  return (
    <div className="slf-fade">
      <TopBar title={name} onBack={onBack} />
      <div className="slf-scroll">
        <div className="slf-hero" style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Gauge value={1} max={1} size={86} strokeWidth={8} color="var(--gold)" centerBig={fmt(data.oneRM)} centerSmall={unit} />
          <div>
            <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)" }}>CURRENT 1RM</div>
            <div className="slf-display" style={{ fontSize: 20 }}>{fmt(data.oneRM)} {unit}</div>
            <div style={{ fontSize: 12, color: "var(--steel)" }}>
              {data.isBodyweight ? "added weight" : "barbell weight"} · {data.tests.length} test{data.tests.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        {goal && (
          <div className="slf-card slf-exlist-item" style={{ marginTop: 16, cursor: "pointer" }} onClick={onViewPlan}>
            <div>
              <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>PEAK PLAN · SESSION {currentSession}/{goal.totalSessions}</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginTop: 3 }}>{fmt(goal.targetOneRM)} {unit} target</div>
            </div>
            <ChevronRight size={18} color="var(--steel)" />
          </div>
        )}
        {showRetestBanner && (
          <div className="slf-banner" style={{ marginTop: goal ? 0 : 16 }}>
            <Flame size={20} color="var(--gold)" />
            <div style={{ fontSize: 12.5 }}>Time to retest to keep your plan accurate.</div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          {goal ? (
            <button className="slf-btn slf-btn-primary" style={{ flex: 1 }} onClick={onViewPlan}>View Peak Plan</button>
          ) : (
            <button className="slf-btn slf-btn-primary" style={{ flex: 1 }} onClick={onLogFreeform}>Log a session</button>
          )}
          <button className="slf-btn slf-btn-ghost" style={{ flex: 1 }} onClick={onRetest}>Retest 1RM</button>
        </div>
        {goal && (
          <button className="slf-btn slf-btn-ghost" style={{ width: "100%", marginTop: 10 }} onClick={onLogFreeform}>
            Log a freeform session (outside the plan)
          </button>
        )}

        <button className="slf-btn slf-btn-ghost" style={{ width: "100%", marginTop: 10 }} onClick={onSetGoal}>
          {goal ? "Edit Peak Goal" : "Set a Peak Goal"}
        </button>

        {chartData.length > 1 && (
          <div style={{ marginTop: 24 }}>
            <span className="slf-label">1RM over time</span>
            <div className="slf-card" style={{ height: 180, padding: "16px 8px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#332e17" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#a39c85" tick={{ fontSize: 10, fontFamily: "Space Mono" }} />
                  <YAxis stroke="#a39c85" tick={{ fontSize: 10, fontFamily: "Space Mono" }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#151310", border: "1px solid #332e17", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#f5f1e6" }} />
                  <Line type="monotone" dataKey="value" stroke="#ffcc00" strokeWidth={2.5} dot={{ r: 3, fill: "#ffcc00" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        <ExerciseHistoryList data={data} unit={unit} onDeleteTest={onDeleteTest} onDeleteSession={onDeleteSession} onEditSession={onEditSession} compact />
      </div>
    </div>
  );
}

/* ───────────────────────── Log Picker ───────────────────────── */

function LogPicker({ exData, onPick, onOpenPlan, onAddExercise }) {
  const names = Object.keys(exData);
  if (names.length === 0) {
    return (
      <div className="slf-fade">
        <TopBar title="Log a session" />
        <div className="slf-scroll">
          <EmptyState icon={<PenSquare size={28} />} title="No lifts yet"
            sub="Add a lift first to log sessions against it." action="Add your first lift" onAction={onAddExercise} />
        </div>
      </div>
    );
  }
  return (
    <div className="slf-fade">
      <TopBar title="Log a session" />
      <div className="slf-scroll">
        <p style={{ color: "var(--steel)", fontSize: 13, marginBottom: 16 }}>Choose which lift to log today.</p>
        {names.map((n) => {
          const d = exData[n];
          const goal = d.goal && d.goal.active ? d.goal : null;
          return (
            <div key={n} className="slf-exlist-item" onClick={() => onPick(n)}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{n}</div>
                  {goal && <span className="slf-chip gold"><Flame size={11} />peak</span>}
                </div>
                <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 3 }}>1RM {fmt(d.oneRM)}</div>
              </div>
              {goal && (
                <button className="slf-btn slf-btn-ghost" style={{ padding: "7px 12px", fontSize: 11 }}
                  onClick={(e) => { e.stopPropagation(); onOpenPlan(n); }}>
                  View plan
                </button>
              )}
              <ChevronRight size={18} color="var(--steel)" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── Category Picker — glass buttons ───────────────────────── */

function CategoryPicker({ name, data, unit, onBack, onPick }) {
  const oneRM = data ? data.oneRM || 0 : 0;
  const accentAlpha = { strength: "rgba(255,204,0,", endurance: "rgba(224,165,38,", resistance: "rgba(167,139,250," };
  return (
    <div className="slf-fade">
      <TopBar title={`Log · ${name}`} onBack={onBack} />
      <div className="slf-scroll">
        <div className="slf-hero" style={{ display: "flex", alignItems: "center", gap: 18, padding: "18px 20px", marginBottom: 28 }}>
          <Gauge value={1} max={1} size={64} strokeWidth={6} color="var(--gold)" centerBig={fmt(oneRM)} centerSmall={unit} />
          <div>
            <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>CURRENT 1RM · {name.toUpperCase()}</div>
            <div className="slf-display" style={{ fontSize: 20, marginTop: 2 }}>{fmt(oneRM)} {unit}</div>
            <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 2 }}>
              {data?.isBodyweight ? "added weight" : "barbell weight"}
            </div>
          </div>
        </div>
        <span className="slf-label">What are you training today?</span>
        {CATEGORIES.map((cat) => {
          const alpha = accentAlpha[cat.id] || "rgba(255,255,255,";
          return (
            <button key={cat.id} className="slf-cat-glass-btn"
              style={{ borderColor: `${alpha}0.20)`, background: `${alpha}0.06)` }}
              onClick={() => onPick(cat.id)}>
              <div>
                <div className="slf-display" style={{ fontSize: 22, color: cat.color, marginBottom: 4 }}>{cat.label}</div>
                <div style={{ fontSize: 13, color: "var(--steel)" }}>{cat.tagline}</div>
              </div>
              <ChevronRight size={18} color={cat.color} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── Goal Setup ───────────────────────── */

function GoalSetup({ name, data, unit, bodyweight, onBack, onSave, onRemoveGoal }) {
  const oneRM = data ? data.oneRM || 0 : 0;
  const existingGoal = data && data.goal && data.goal.active ? data.goal : null;
  const [targetWeight, setTargetWeight] = useState(existingGoal ? String(existingGoal.targetOneRM) : "");
  const [targetWeeks, setTargetWeeks] = useState(existingGoal ? String(existingGoal.targetWeeks) : "12");
  const [manualLevel, setManualLevel] = useState(existingGoal?.level || "intermediate");
  const [sessionsPerWeek, setSessionsPerWeek] = useState(existingGoal?.sessionsPerWeek || DEFAULT_SESSIONS_PER_WEEK);
  const [safePace, setSafePace] = useState(existingGoal ? !!existingGoal.safePace : true);

  if (!data) return null;

  if (!oneRM) {
    return (
      <div className="slf-fade">
        <TopBar title="Set a Peak Goal" onBack={onBack} />
        <div className="slf-scroll">
          <EmptyState icon={<Flame size={28} />} title="Test your 1RM first"
            sub={`Run a 1RM test for ${name} before setting a peak goal — the plan is built from your current max.`} />
        </div>
      </div>
    );
  }

  const detectedLevel = detectLevel(oneRM, bodyweight, data.isBodyweight);
  const level = detectedLevel || manualLevel;
  const weeklyGainCapPct = weeklyCapForLevel(level);
  const ratio = loadRatio(oneRM, bodyweight, data.isBodyweight);

  const targetNum = Number(targetWeight) || 0;
  const weeksNum = Math.max(1, Math.round(Number(targetWeeks)) || 1);
  const spw = Math.max(1, Number(sessionsPerWeek) || DEFAULT_SESSIONS_PER_WEEK);
  const requiredGainPct = targetNum > oneRM ? ((targetNum - oneRM) / oneRM) * 100 : 0;
  const minWeeksNeeded = requiredGainPct > 0 ? Math.ceil(requiredGainPct / weeklyGainCapPct) : 1;
  const effectiveWeeks = safePace ? Math.max(weeksNum, minWeeksNeeded, 1) : weeksNum;
  const totalSessionsPreview = totalSessionsFor(effectiveWeeks, spw);
  const willExtend = safePace && targetNum > oneRM && effectiveWeeks > weeksNum;
  const isAggressive = !safePace && requiredGainPct > 0 && weeksNum < minWeeksNeeded;
  const alreadyThere = targetNum > 0 && targetNum <= oneRM;
  const canSave = targetNum > oneRM && weeksNum >= 1;

  return (
    <div className="slf-fade">
      <TopBar title={existingGoal ? "Edit Peak Goal" : "Set a Peak Goal"} onBack={onBack} />
      <div className="slf-scroll">
        <div className="slf-hero" style={{ display: "flex", alignItems: "center", gap: 18, padding: "18px 20px", marginBottom: 22 }}>
          <Gauge value={1} max={1} size={64} strokeWidth={6} color="var(--gold)" centerBig={fmt(oneRM)} centerSmall={unit} />
          <div>
            <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>CURRENT 1RM · {name.toUpperCase()}</div>
            <div className="slf-display" style={{ fontSize: 20, marginTop: 2 }}>{fmt(oneRM)} {unit}</div>
          </div>
        </div>

        <div className="slf-card" style={{ marginBottom: 16 }}>
          <span className="slf-label" style={{ margin: 0, marginBottom: 10, display: "block" }}>Training level</span>
          {detectedLevel ? (
            <p style={{ fontSize: 13, margin: 0 }}>
              Detected: <strong style={{ textTransform: "capitalize" }}>{detectedLevel}</strong>
              {ratio != null ? ` (${ratio.toFixed(2)}× bodyweight)` : ""} → up to ~{weeklyGainCapPct}%/week
            </p>
          ) : (
            <>
              <p style={{ fontSize: 12, color: "var(--steel)", marginTop: 0, marginBottom: 10 }}>
                Add your bodyweight in Settings to auto-detect this next time. For now, pick your level:
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                {["novice", "intermediate", "advanced"].map((lvl) => (
                  <button key={lvl} className="slf-btn" style={{
                    flex: 1, padding: "9px 10px", fontSize: 12, textTransform: "capitalize",
                    background: manualLevel === lvl ? "var(--gold)" : "transparent",
                    color: manualLevel === lvl ? "#151310" : "var(--text)",
                    border: "1px solid var(--border)",
                  }} onClick={() => setManualLevel(lvl)}>{lvl}</button>
                ))}
              </div>
            </>
          )}
        </div>

        <span className="slf-label">Target 1RM ({unit})</span>
        <input className="slf-input" style={{ marginBottom: 16 }} type="number" inputMode="decimal"
          value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)}
          placeholder={`e.g. ${fmt(oneRM * 1.15)}`} />

        <span className="slf-label">Target timeframe (weeks)</span>
        <input className="slf-input" style={{ marginBottom: 16 }} type="number" inputMode="numeric"
          value={targetWeeks} onChange={(e) => setTargetWeeks(e.target.value)} placeholder="12" />

        <span className="slf-label">Sessions per week for this lift</span>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {[2, 3, 4, 5].map((n) => (
            <button key={n} className="slf-btn" style={{
              flex: 1, padding: "9px 10px", fontSize: 13,
              background: spw === n ? "var(--gold)" : "transparent",
              color: spw === n ? "#151310" : "var(--text)",
              border: "1px solid var(--border)",
            }} onClick={() => setSessionsPerWeek(n)}>{n}×</button>
          ))}
        </div>
        <p style={{ color: "var(--steel)", fontSize: 11, marginTop: 0, marginBottom: 16 }}>
          The plan is driven by sessions actually logged, not the calendar — train more or fewer times some weeks and the plan just compresses or stretches, it won't fall out of sync.
        </p>

        <div className="slf-card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Safe pace</div>
              <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 3, maxWidth: 220 }}>
                {safePace
                  ? "Auto-extends your plan if the gain is too fast for your level."
                  : "Strictly follows your timeframe, even if the ramp is aggressive."}
              </div>
            </div>
            <button className="slf-btn" style={{
              padding: "8px 14px", fontSize: 12,
              background: safePace ? "var(--gold)" : "transparent",
              color: safePace ? "#151310" : "var(--text)",
              border: "1px solid var(--border)",
            }} onClick={() => setSafePace((s) => !s)}>
              {safePace ? "On" : "Off"}
            </button>
          </div>
        </div>

        {alreadyThere && (
          <p style={{ color: "var(--teal)", fontSize: 12, marginTop: 6, marginBottom: 16 }}>
            You're already at or above this target — enter a higher number to build a plan.
          </p>
        )}
        {willExtend && (
          <div className="slf-banner" style={{ marginTop: 6 }}>
            <Flame size={20} color="var(--gold)" />
            <div style={{ fontSize: 12.5 }}>
              Your goal needs about <strong>{effectiveWeeks} weeks</strong> at a safe pace for a {level} lifter — extended from {weeksNum}. Turn off "Safe pace" above to force the {weeksNum}-week timeframe.
            </div>
          </div>
        )}
        {isAggressive && (
          <div className="slf-banner" style={{ marginTop: 6, borderColor: "#d16a6a" }}>
            <Flame size={20} color="#d16a6a" />
            <div style={{ fontSize: 12.5 }}>
              That's about <strong>{fmt(requiredGainPct / weeksNum)}%/week</strong> — faster than the usual safe pace for a {level} lifter (~{weeklyGainCapPct}%/week, ≈{minWeeksNeeded} weeks). Building it for your {weeksNum}-week timeframe anyway since Safe pace is off — watch form and fatigue, and retest often.
            </div>
          </div>
        )}
        {!willExtend && !isAggressive && !alreadyThere && targetNum > oneRM && (
          <p style={{ color: "var(--steel)", fontSize: 12, marginTop: 6, marginBottom: 16 }}>
            {effectiveWeeks}-week plan · {totalSessionsPreview} sessions · ramping toward {fmt(targetNum)} {unit}, deload every 4th week, retest every {GOAL_DEFAULTS.retestEveryWeeks} weeks.
          </p>
        )}

        <button className="slf-btn slf-btn-primary" style={{ width: "100%", marginTop: 18 }}
          disabled={!canSave}
          onClick={() => onSave(targetNum, weeksNum, manualLevel, spw, safePace)}>
          {existingGoal ? "Update plan" : "Generate plan"}
        </button>

        {existingGoal && (
          <button className="slf-btn slf-btn-ghost" style={{ width: "100%", marginTop: 10, color: "#d16a6a" }}
            onClick={onRemoveGoal}>
            Remove goal
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Weekly Plan ───────────────────────── */

function WeeklyPlan({ name, data, unit, onBack, onEditGoal, onPickSession }) {
  if (!data || !data.goal || !data.goal.active) return null;
  const goal = data.goal;
  const currentSession = getGoalCurrentSession(goal);
  const hasTestThisWeek = data.tests.some((t) => mondayOf(t.date) === mondayOf(todayStr()));
  const currentRow = goal.plan.find((r) => r.session === currentSession);
  const showRetestBanner = currentRow && currentRow.retestDue && !hasTestThisWeek;

  // Group the flat session list into week buckets for a readable display —
  // the plan itself is session-driven, "week" is just the label.
  const weekGroups = [];
  for (const row of goal.plan) {
    let grp = weekGroups.find((g) => g.week === row.week);
    if (!grp) { grp = { week: row.week, rows: [] }; weekGroups.push(grp); }
    grp.rows.push(row);
  }

  return (
    <div className="slf-fade">
      <TopBar title="Peak Plan" onBack={onBack} />
      <div className="slf-scroll">
        <div className="slf-hero" style={{ padding: "20px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>{name.toUpperCase()} · TARGET</div>
              <div className="slf-display" style={{ fontSize: 26 }}>{fmt(goal.targetOneRM)} {unit}</div>
              <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 4 }}>
                from {fmt(goal.startingOneRM)} {unit} · session {currentSession} of {goal.totalSessions} · {goal.sessionsPerWeek}×/week
              </div>
            </div>
            <button className="slf-btn slf-btn-ghost" style={{ padding: "8px 12px", fontSize: 12 }} onClick={onEditGoal}>Edit</button>
          </div>
        </div>

        {showRetestBanner && (
          <div className="slf-banner">
            <Flame size={20} color="var(--gold)" />
            <div style={{ fontSize: 12.5 }}>Time to retest to keep your plan accurate.</div>
          </div>
        )}

        {goal.lastRetestDate && (
          <p style={{ color: "var(--steel)", fontSize: 11, marginBottom: 14 }}>
            Sessions ahead recalculated from your {goal.lastRetestDate} retest.
          </p>
        )}

        {weekGroups.map((grp) => {
          const isDeloadWeek = grp.rows.some((r) => r.isDeload);
          const isRetestWeek = grp.rows.some((r) => r.retestDue);
          return (
            <div key={grp.week} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span className="slf-label" style={{ margin: 0 }}>Week {grp.week}</span>
                {isDeloadWeek && <span className="slf-chip">deload</span>}
                {isRetestWeek && <span className="slf-chip teal">retest</span>}
              </div>
              {grp.rows.map((row) => {
                const isCurrent = row.session === currentSession;
                return (
                  <div key={row.session}
                    className="slf-exlist-item"
                    style={{ cursor: "pointer", borderColor: isCurrent ? "var(--gold)" : "var(--border)" }}
                    onClick={() => onPickSession(row)}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>Session {row.session}</span>
                        {isCurrent && <span className="slf-chip gold">current</span>}
                        {row.done && <Check size={14} color="var(--teal)" />}
                      </div>
                      <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)" }}>
                        {row.percent}% · {fmt(row.weight)} {unit} · {row.sets}×{row.repsPerSet}
                      </div>
                    </div>
                    <ChevronRight size={18} color="var(--steel)" />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── LogSession — planning screen ───────────────────────── */

function LogSession({ name, data, unit, bodyweight, category: initialCategory, from, onBack, onStartWorkout }) {
  const oneRM = data ? data.oneRM || 0 : 0;
  const seedCat = CATEGORIES.find((c) => c.id === initialCategory) || null;
  const seedPct = seedCat ? categoryMidpoint(seedCat) : 80;
  const seedWeight = percentToWeight(seedPct, oneRM, unit);
  const seedSets = seedCat ? seedCat.defaultSets : 5;
  const seedReps = seedCat ? seedCat.defaultReps : 5;

  const [percent, setPercent] = useState(seedPct);
  const [weight, setWeight] = useState(seedWeight);
  const [targetSets, setTargetSets] = useState(seedSets);
  const [targetReps, setTargetReps] = useState(seedReps);

  if (!data) return null;
  const activeCategory = CATEGORIES.find((c) => c.id === initialCategory);

  const stepPercent = (delta) => {
    const next = Math.max(0, Math.min(100, percent + delta));
    setPercent(next);
    setWeight(percentToWeight(next, oneRM, unit));
  };

  const onWeightChange = (rawVal) => {
    setWeight(rawVal);
    setPercent(weightToPercent(rawVal, oneRM));
  };

  return (
    <div className="slf-fade">
      <TopBar title={`Log · ${name}`} onBack={onBack} />
      <div className="slf-scroll">
        {activeCategory && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <span className="slf-chip" style={{ color: activeCategory.color, borderColor: activeCategory.color + "55", fontSize: 13, padding: "7px 14px" }}>
              {activeCategory.label}
            </span>
            <span className="slf-mono" style={{ fontSize: 11, color: "var(--steel)" }}>
              {activeCategory.min}–{activeCategory.max}% · {activeCategory.repOptions[0]}–{activeCategory.repOptions[activeCategory.repOptions.length - 1]} reps
            </span>
          </div>
        )}
        <div className="slf-hero" style={{ padding: "22px 18px", textAlign: "center", marginBottom: 14 }}>
          <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)", marginBottom: 10 }}>
            {activeCategory ? `${activeCategory.label.toUpperCase()} · ` : "MANUAL · "}% OF 1RM
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18 }}>
            <button className="slf-stepper-btn" onClick={() => stepPercent(-5)} aria-label="Decrease"><Minus size={18} /></button>
            <div className="slf-display" style={{ fontSize: 44, minWidth: 110 }}>{percent}%</div>
            <button className="slf-stepper-btn" onClick={() => stepPercent(5)} aria-label="Increase"><Plus size={18} /></button>
          </div>
          <div className="slf-mono" style={{ fontSize: 12, color: "var(--steel)", marginTop: 14 }}>
            of {fmt(oneRM)} {unit} 1RM → <strong style={{ color: "var(--gold)" }}>{fmt(weight)} {unit}{data.isBodyweight ? " added" : ""}</strong>
          </div>
        </div>
        <div className="slf-card" style={{ marginBottom: 14 }}>
          <span className="slf-label">Or enter the weight directly ({unit})</span>
          <input className="slf-input" type="number" inputMode="decimal" value={weight}
            onChange={(e) => onWeightChange(e.target.value)} />
          <p style={{ color: "var(--steel)", fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            Editing weight updates the % above, and vice versa.
          </p>
        </div>
        {activeCategory && (
          <div style={{ marginBottom: 14 }}>
            <span className="slf-label">Target reps per set</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {activeCategory.repOptions.map((r) => (
                <button key={r} className="slf-btn" style={{
                  padding: "9px 15px", fontSize: 13,
                  background: targetReps === r ? activeCategory.color : "transparent",
                  color: targetReps === r ? "#151310" : "var(--text)",
                  border: "1px solid var(--border)",
                }} onClick={() => setTargetReps(r)}>{r}</button>
              ))}
            </div>
          </div>
        )}
        <RepMaxTable data={data} bodyweight={bodyweight} unit={unit} activePercent={percent} category={activeCategory} />
        <button className="slf-btn slf-btn-primary" style={{ width: "100%", marginTop: 8 }}
          onClick={() => onStartWorkout({ category: initialCategory, percent, weight, targetSets, targetReps })}>
          Start Workout
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── WarmupScreen ───────────────────────── */

function WarmupScreen({ name, data, unit, category, weight, targetSets, targetReps, onBack, onContinue }) {
  const { mobility, rampSets } = useMemo(
    () => getExerciseWarmup(name, Number(weight) || 0, unit, data?.isBodyweight || false),
    [name, weight, unit, data]
  );
  const [mobilityDone, setMobilityDone] = useState(() => Array(mobility.length).fill(false));
  const [rampDone, setRampDone]         = useState(() => Array(rampSets.length).fill(false));
  const toggleM = (i) => setMobilityDone((p) => { const n = [...p]; n[i] = !n[i]; return n; });
  const toggleR = (i) => setRampDone((p)   => { const n = [...p]; n[i] = !n[i]; return n; });
  const activeCategory = CATEGORIES.find((c) => c.id === category);

  return (
    <div className="slf-fade">
      <TopBar title="Warm-up" onBack={onBack} />
      <div className="slf-scroll">
        <div className="slf-hero" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", marginBottom: 20 }}>
          <div>
            <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>WORKING WEIGHT</div>
            <div className="slf-display" style={{ fontSize: 26 }}>{fmt(Number(weight))} {unit}{data?.isBodyweight ? " added" : ""}</div>
            <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 4 }}>{name} · {targetSets} × {targetReps}</div>
          </div>
          {activeCategory && (
            <span className="slf-chip" style={{ color: activeCategory.color, borderColor: activeCategory.color + "55" }}>
              {activeCategory.label}
            </span>
          )}
        </div>

        {mobility.length > 0 && (
          <div className="slf-card" style={{ marginBottom: 14 }}>
            <span className="slf-label" style={{ margin: 0, marginBottom: 14, display: "block" }}>Mobility &amp; activation</span>
            {mobility.map((drill, i) => (
              <div key={i} className={`slf-warmup-row${mobilityDone[i] ? " done" : ""}`}
                style={{ borderBottom: i < mobility.length - 1 ? "1px solid var(--border)" : "none" }}>
                <button className={`slf-check-circle${mobilityDone[i] ? " done" : ""}`} onClick={() => toggleM(i)}>
                  {mobilityDone[i] && <Check size={13} color="#060606" />}
                </button>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, textDecoration: mobilityDone[i] ? "line-through" : "none" }}>{drill.label}</div>
                  <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 3 }}>{drill.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="slf-card" style={{ marginBottom: 20 }}>
          <span className="slf-label" style={{ margin: 0, marginBottom: 14, display: "block" }}>Bar ramp-up</span>
          {rampSets.map((s, i) => (
            <div key={i} className={`slf-warmup-row${rampDone[i] ? " done" : ""}`}
              style={{ borderBottom: i < rampSets.length - 1 ? "1px solid var(--border)" : "none" }}>
              <button className={`slf-check-circle${rampDone[i] ? " done" : ""}`} onClick={() => toggleR(i)}>
                {rampDone[i] && <Check size={13} color="#060606" />}
              </button>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>{s.label}</span>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>
                    {s.weight === 0 ? "BW only" : `${fmt(s.weight)} ${unit}${data?.isBodyweight ? " added" : ""}`} × {s.reps}
                  </span>
                </div>
                {s.note ? <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 3 }}>{s.note}</div> : null}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 14, marginTop: 4, borderTop: "1px solid var(--border)" }}>
            <span className="slf-mono" style={{ fontSize: 10, color: "var(--gold)" }}>WORKING SETS</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--gold)" }}>
              {data?.isBodyweight
                ? (Number(weight) === 0 ? "BW only" : `${fmt(Number(weight))} ${unit} added`)
                : `${fmt(Number(weight))} ${unit}`}
            </span>
          </div>
        </div>

        <button className="slf-btn slf-btn-primary" style={{ width: "100%" }} onClick={onContinue}>
          Ready — start working sets
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── WorkoutSession ───────────────────────── */

function WorkoutSession({ name, data, unit, bodyweight, category, percent, weight, targetSets, targetReps, goalSession, onBack, onSubmit }) {
  const activeCategory = CATEGORIES.find((c) => c.id === category);
  const [setsChecked, setSetsChecked] = useState(() => Array(targetSets).fill(false));
  const [restTrigger, setRestTrigger] = useState(0);
  const [weightUsed, setWeightUsed] = useState(String(fmt(weight)));
  const [setsCompleted, setSetsCompleted] = useState(String(targetSets));
  const [repsCompleted, setRepsCompleted] = useState(String(targetReps));
  const [rpe, setRpe] = useState("");
  const [notes, setNotes] = useState("");

  if (!data) return null;
  const canSubmit = weightUsed && setsCompleted && repsCompleted;

  const toggleSet = (idx) => {
    const next = [...setsChecked];
    next[idx] = !next[idx];
    setSetsChecked(next);
    if (next[idx]) setRestTrigger((k) => k + 1);
  };

  return (
    <div className="slf-fade">
      <TopBar title="Workout" onBack={onBack} />
      <div className="slf-scroll">
        <div className="slf-hero" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px", marginBottom: 14 }}>
          <div>
            <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>WORKING WEIGHT</div>
            <div className="slf-display" style={{ fontSize: 30 }}>{fmt(weight)} {unit}{data.isBodyweight ? " added" : ""}</div>
            <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 4 }}>{percent}% of 1RM{goalSession != null ? ` · Session ${goalSession}` : ""}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>TARGET</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{targetSets} × {targetReps}</div>
          </div>
        </div>

        {targetSets > 0 && (
          <div className="slf-card" style={{ marginBottom: 14 }}>
            <span className="slf-label" style={{ margin: 0, marginBottom: 10, display: "block" }}>
              {targetSets} sets — tap each when done
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Array.from({ length: targetSets }).map((_, idx) => (
                <button key={idx} className="slf-btn" style={{
                  padding: "10px 16px", fontSize: 13,
                  background: setsChecked[idx] ? "var(--teal)" : "transparent",
                  color: setsChecked[idx] ? "#060606" : "var(--text)",
                  border: `1px solid ${setsChecked[idx] ? "var(--teal)" : "var(--border)"}`,
                  display: "flex", alignItems: "center", gap: 5,
                  transition: "all 0.2s ease",
                }} onClick={() => toggleSet(idx)}>
                  {setsChecked[idx] && <Check size={13} />}Set {idx + 1}
                </button>
              ))}
            </div>
            <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)", marginTop: 10 }}>
              {setsChecked.filter(Boolean).length}/{targetSets} completed
            </div>
          </div>
        )}

        <RestTimer defaultSeconds={120} triggerKey={restTrigger} />

        <div className="slf-section-divider">
          <span className="slf-mono" style={{ fontSize: 10, color: "var(--steel)", whiteSpace: "nowrap" }}>LOG YOUR RESULTS</span>
        </div>

        <div className="slf-card">
          <span className="slf-label">{data.isBodyweight ? `Added weight used (${unit})` : `Weight used (${unit})`}</span>
          <input className="slf-input" style={{ marginBottom: 14 }} type="number" inputMode="decimal"
            value={weightUsed} onChange={(e) => setWeightUsed(e.target.value)} />
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <span className="slf-label">Sets completed</span>
              <input className="slf-input" type="number" inputMode="numeric"
                value={setsCompleted} onChange={(e) => setSetsCompleted(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <span className="slf-label">Reps per set</span>
              <input className="slf-input" type="number" inputMode="numeric"
                value={repsCompleted} onChange={(e) => setRepsCompleted(e.target.value)} />
            </div>
          </div>
          <span className="slf-label">RPE (optional)</span>
          <input className="slf-input" style={{ marginBottom: 14 }} type="number" inputMode="decimal"
            min="1" max="10" value={rpe} onChange={(e) => setRpe(e.target.value)} placeholder="1–10" />
          <span className="slf-label">Notes (optional)</span>
          <textarea className="slf-input" style={{ fontFamily: "Inter", fontSize: 14, minHeight: 70, resize: "vertical" }}
            value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did it feel?" />
          <button className="slf-btn slf-btn-primary" style={{ width: "100%", marginTop: 18 }}
            disabled={!canSubmit}
            onClick={() => onSubmit({ name, category, percent, weightUsed, setsCompleted, repsCompleted, rpe, notes, goalSession })}>
            Log session
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── History list ───────────────────────── */

function ExerciseHistoryList({ data, unit, onDeleteTest, onDeleteSession, onEditSession, compact }) {
  const [editing, setEditing] = useState(null);
  const items = [
    ...data.tests.map((t) => ({ kind: "test", ...t })),
    ...data.sessions.map((s) => ({ kind: "session", ...s })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  if (items.length === 0) {
    return (
      <div style={{ marginTop: 20 }}>
        <span className="slf-label">History</span>
        <div className="slf-card" style={{ textAlign: "center", color: "var(--steel)", fontSize: 13, padding: 24 }}>Nothing logged yet.</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 20 }}>
      <span className="slf-label">History{compact ? "" : ` · ${data.name}`}</span>
      {items.map((it) => (
        <div key={it.id} className="slf-card" style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)" }}>{it.date}</div>
            {it.kind === "test" ? (
              <div style={{ fontSize: 13, marginTop: 4 }}>
                <span className="slf-chip gold" style={{ marginRight: 6 }}>1RM test</span>
                {data.isBodyweight
                  ? <>added {fmt(it.weightInput)} {unit} × {it.reps} → <strong>{fmt(it.result)} {unit} added</strong></>
                  : <>{fmt(it.weightInput)} {unit} × {it.reps} → <strong>{fmt(it.result)} {unit}</strong></>}
              </div>
            ) : (
              <div style={{ fontSize: 13, marginTop: 4 }}>
                {it.percent != null && <span className="slf-chip" style={{ marginRight: 6 }}>{it.percent}%</span>}
                {it.setsCompleted}×{it.repsCompleted} @ {fmt(it.weightUsed)} {unit}{data.isBodyweight ? " added" : ""}
                {it.rpe ? ` · RPE ${it.rpe}` : ""}
                {it.notes ? <div style={{ color: "var(--steel)", marginTop: 4, fontSize: 12 }}>{it.notes}</div> : null}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {it.kind === "session" && (
              <button className="slf-btn" style={{ background: "none", color: "var(--steel)", padding: 6 }}
                onClick={() => setEditing(it)} aria-label="Edit"><Pencil size={15} /></button>
            )}
            <button className="slf-btn" style={{ background: "none", color: "var(--steel)", padding: 6 }}
              onClick={() => it.kind === "test" ? onDeleteTest(it.id) : onDeleteSession(it.id)} aria-label="Delete">
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      ))}
      {editing && (
        <div className="slf-modal-overlay" onClick={() => setEditing(null)}>
          <div className="slf-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div className="slf-display" style={{ fontSize: 16 }}>Edit session</div>
              <button className="slf-btn" style={{ background: "none", padding: 4 }} onClick={() => setEditing(null)}><X size={20} /></button>
            </div>
            <EditSessionForm item={editing} unit={unit} onSave={(patch) => { onEditSession(editing.id, patch); setEditing(null); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function EditSessionForm({ item, unit, onSave }) {
  const [weightUsed, setWeightUsed] = useState(String(item.weightUsed));
  const [sets, setSets]             = useState(String(item.setsCompleted));
  const [reps, setReps]             = useState(String(item.repsCompleted));
  const [rpe, setRpe]               = useState(item.rpe ? String(item.rpe) : "");
  const [notes, setNotes]           = useState(item.notes || "");
  return (
    <div>
      <span className="slf-label">Weight used ({unit})</span>
      <input className="slf-input" style={{ marginBottom: 12 }} type="number" value={weightUsed} onChange={(e) => setWeightUsed(e.target.value)} />
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}><span className="slf-label">Sets</span><input className="slf-input" type="number" value={sets} onChange={(e) => setSets(e.target.value)} /></div>
        <div style={{ flex: 1 }}><span className="slf-label">Reps</span><input className="slf-input" type="number" value={reps} onChange={(e) => setReps(e.target.value)} /></div>
      </div>
      <span className="slf-label">RPE</span>
      <input className="slf-input" style={{ marginBottom: 12 }} type="number" value={rpe} onChange={(e) => setRpe(e.target.value)} />
      <span className="slf-label">Notes</span>
      <textarea className="slf-input" style={{ fontFamily: "Inter", fontSize: 14, minHeight: 60, marginBottom: 16 }}
        value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button className="slf-btn slf-btn-primary" style={{ width: "100%" }}
        onClick={() => onSave({ weightUsed: Number(weightUsed), setsCompleted: Number(sets), repsCompleted: Number(reps), rpe: rpe === "" ? null : Number(rpe), notes })}>
        Save changes
      </button>
    </div>
  );
}

/* ───────────────────────── History screen ───────────────────────── */

function HistoryScreen({ exData, unit, onDeleteTest, onDeleteSession, onBack }) {
  const names = Object.keys(exData);
  const [active, setActive] = useState(names[0] || null);
  if (names.length === 0) {
    return (
      <div className="slf-fade">
        <TopBar title="History" onBack={onBack} />
        <div className="slf-scroll">
          <EmptyState icon={<HistoryIcon size={28} />} title="Nothing to show" sub="Log a session or a 1RM test to see it here." />
        </div>
      </div>
    );
  }
  return (
    <div className="slf-fade">
      <TopBar title="History" onBack={onBack} />
      <div className="slf-scroll">
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 6 }}>
          {names.map((n) => (
            <button key={n} className="slf-btn slf-mono" style={{
              whiteSpace: "nowrap", padding: "8px 14px", fontSize: 11,
              background: active === n ? "var(--gold)" : "transparent",
              color: active === n ? "#151310" : "var(--steel)",
              border: "1px solid var(--border)",
            }} onClick={() => setActive(n)}>{n.toUpperCase()}</button>
          ))}
        </div>
        {active && (
          <ExerciseHistoryList data={exData[active]} unit={unit}
            onDeleteTest={(id) => onDeleteTest(active, id)}
            onDeleteSession={(id) => onDeleteSession(active, id)}
            onEditSession={() => {}} />
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Stats ───────────────────────── */

function StatsScreen({ exData, unit, bodyweight, onOpenHistory }) {
  const names = Object.keys(exData);
  const [filter, setFilter] = useState("all");
  const streak = useMemo(() => computeStreak(exData), [exData]);
  const totalSessions = names.reduce((sum, n) => sum + exData[n].sessions.length, 0);
  if (names.length === 0 || totalSessions === 0) {
    return (
      <div className="slf-fade">
        <TopBar title="Stats" />
        <div className="slf-scroll">
          <EmptyState icon={<BarChart3 size={28} />} title="Nothing to show yet"
            sub="Log your first session to start building a streak and a tonnage trend." />
        </div>
      </div>
    );
  }
  return (
    <div className="slf-fade">
      <TopBar title="Stats" />
      <div className="slf-scroll">
        <div className="slf-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <StreakBadge current={streak.current} best={streak.best} size="big" />
        </div>
        <button className="slf-btn slf-btn-ghost" style={{ width: "100%", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          onClick={onOpenHistory}>
          <HistoryIcon size={16} /> View full history
        </button>
        <span className="slf-label">Training calendar · last 12 weeks</span>
        <div className="slf-card" style={{ marginBottom: 20 }}><TrainingCalendar exData={exData} weeks={12} /></div>
        <span className="slf-label" style={{ display: "block", marginBottom: 4 }}>Weekly tonnage</span>
        <p style={{ color: "var(--steel)", fontSize: 12, marginTop: 0, marginBottom: 12 }}>
          Total sets × reps × weight moved per week — keeps rising even in weeks your max plateaus.
        </p>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
          {["all", ...names].map((n) => (
            <button key={n} className="slf-btn slf-mono" style={{
              whiteSpace: "nowrap", padding: "8px 14px", fontSize: 11,
              background: filter === n ? "var(--gold)" : "transparent",
              color: filter === n ? "#151310" : "var(--steel)",
              border: "1px solid var(--border)",
            }} onClick={() => setFilter(n)}>{n === "all" ? "ALL LIFTS" : n.toUpperCase()}</button>
          ))}
        </div>
        <TonnageChart exData={exData} bodyweight={bodyweight} unit={unit} exerciseFilter={filter === "all" ? null : filter} />
      </div>
    </div>
  );
}

/* ───────────────────────── Exercise Library ───────────────────────── */

function LibraryExerciseCard({ ex, expanded, onToggle }) {
  return (
    <div className="slf-exlist-item" style={{ flexDirection: "column", alignItems: "stretch", cursor: "pointer" }} onClick={onToggle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{ex.name}</div>
          <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 3 }}>{ex.category}</div>
        </div>
        <ChevronRight size={18} color="var(--steel)" style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }} />
      </div>
      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
          <p style={{ fontSize: 13, color: "var(--steel)", margin: 0, marginBottom: 12, lineHeight: 1.5 }}>{ex.description}</p>
          <span className="slf-label">Sets & reps</span>
          <p style={{ fontSize: 13, marginTop: 0, marginBottom: 12 }}>{ex.setsReps}</p>
          {ex.tips?.length > 0 && (
            <>
              <span className="slf-label">Cues</span>
              <ul style={{ margin: "0 0 12px 0", paddingLeft: 18, fontSize: 13, color: "var(--steel)" }}>
                {ex.tips.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}
              </ul>
            </>
          )}
          {ex.videoUrl ? (
            <button className="slf-btn slf-btn-teal" style={{ width: "100%" }}
              onClick={() => window.open(ex.videoUrl, "_blank", "noopener,noreferrer")}>
              Watch tutorial
            </button>
          ) : (
            <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)" }}>No video linked yet</div>
          )}
        </div>
      )}
    </div>
  );
}

function ExerciseLibrary({ onBack }) {
  const [expandedId, setExpandedId] = useState(null);
  const [filter, setFilter] = useState("all");
  const accessoryCategories = ["all", ...Array.from(new Set(EXERCISE_LIBRARY.accessory.map((e) => e.category)))];
  const filteredAccessories = filter === "all" ? EXERCISE_LIBRARY.accessory : EXERCISE_LIBRARY.accessory.filter((e) => e.category === filter);

  return (
    <div className="slf-fade">
      <TopBar title="Exercise Library" onBack={onBack} />
      <div className="slf-scroll">
        <span className="slf-label">Main lifts</span>
        {EXERCISE_LIBRARY.main.map((ex) => (
          <LibraryExerciseCard key={ex.name} ex={ex} expanded={expandedId === ex.name}
            onToggle={() => setExpandedId(expandedId === ex.name ? null : ex.name)} />
        ))}

        <div className="slf-section-divider">
          <span className="slf-mono" style={{ fontSize: 10, color: "var(--steel)", whiteSpace: "nowrap" }}>ACCESSORY EXERCISES</span>
        </div>

        <div className="slf-chip-row">
          {accessoryCategories.map((c) => (
            <button key={c} className={`slf-filter-chip slf-mono${filter === c ? " active" : ""}`}
              onClick={() => setFilter(c)}>
              {c === "all" ? "ALL" : c.toUpperCase()}
            </button>
          ))}
        </div>

        {filteredAccessories.map((ex) => (
          <LibraryExerciseCard key={ex.name} ex={ex} expanded={expandedId === ex.name}
            onToggle={() => setExpandedId(expandedId === ex.name ? null : ex.name)} />
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── Settings ───────────────────────── */

function AboutStep({ n, title, text, last }) {
  return (
    <div style={{ display: "flex", gap: 14, paddingBottom: last ? 0 : 16, marginBottom: last ? 0 : 16, borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
        background: "rgba(255,204,0,0.12)", border: "1px solid var(--gold)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "Space Mono", fontSize: 12, color: "var(--gold)", fontWeight: 700,
      }}>{n}</div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--steel)", marginTop: 4, lineHeight: 1.5 }}>{text}</div>
      </div>
    </div>
  );
}

function AboutScreen({ onBack, onStart }) {
  return (
    <div className="slf-fade">
      <TopBar title="About Bar & Ring" onBack={onBack} />
      <div className="slf-scroll">
        <div className="slf-hero" style={{ padding: "28px 20px", textAlign: "center", marginBottom: 20 }}>
          <Dumbbell size={36} color="var(--gold)" strokeWidth={1.5} />
          <div className="slf-display" style={{ fontSize: 20, marginTop: 12 }}>What is Bar & Ring?</div>
          <p style={{ color: "var(--steel)", fontSize: 13, marginTop: 10, lineHeight: 1.6 }}>
            A focused strength-training companion for streetlifting: Weighted Pull-up, Weighted Dip, Squat, and Bench Press — plus any custom lift you add. It estimates your one-rep max, builds training percentages, and tracks your progress over time.
          </p>
        </div>

        <span className="slf-label">How to use it</span>
        <div className="slf-card" style={{ marginBottom: 12 }}>
          <AboutStep n={1} title="Add a lift & test your 1RM" text="Pick an exercise, choose a 1RM formula, then enter a weight and rep count from a recent set. The app estimates your one-rep max." />
          <AboutStep n={2} title="Log sessions freely, or set a Peak Goal" text="Log a session anytime by picking a training category (Strength / Endurance / Resistance) and a percentage of your 1RM — or set a target weight and timeframe and get a full session-by-session plan." />
          <AboutStep n={3} title="Warm up, then work" text="Each session opens with mobility drills and a ramp-up to your working weight, followed by a rest timer between working sets." />
          <AboutStep n={4} title="Retest to stay accurate" text="Periodically retest your 1RM — plans automatically recalibrate around your new number without touching sessions you've already completed." />
          <AboutStep n={5} title="Track streaks & tonnage" text="The Stats tab shows your weekly training streak, a training calendar, and tonnage (sets × reps × weight) trends over time." last />
        </div>

        <span className="slf-label">A few notes</span>
        <div className="slf-card">
          <p style={{ fontSize: 12.5, color: "var(--steel)", lineHeight: 1.6, margin: 0 }}>
            1RM estimates are formulas, not lab measurements — treat them as a guide, not gospel. Peak Goal plans include a "Safe pace" toggle: on by default, keeps your weekly gain realistic for your training level, or turn it off to force a specific timeframe.
          </p>
        </div>
        <button className="slf-btn slf-btn-primary" style={{ width: "100%", marginTop: 18 }} onClick={onStart}>
          Start using the app
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Settings ───────────────────────── */

function SettingsScreen({ config, exData, onSaveBodyweight, onToggleUnit, onFormulaOverride, onRemoveExercise, onAddExercise, onSaveReminderDays, onSetNotificationsEnabled, onSaveUserName, onOpenAbout, onBack }) {
  const [bw, setBw] = useState(config.bodyweight || "");
  const [reminderDays, setReminderDays] = useState(config.reminderDays || DEFAULT_REMINDER_DAYS);
  const [name, setName] = useState(config.userName || "");
  const notifSupported = typeof Notification !== "undefined";
  const notifBlocked = notifSupported && Notification.permission === "denied";
  const names = Object.keys(exData);
  return (
    <div className="slf-fade">
      <TopBar title="Settings" onBack={onBack} />
      <div className="slf-scroll">
        <button className="slf-btn slf-btn-ghost" style={{ width: "100%", marginBottom: 20 }} onClick={onOpenAbout}>
          About Bar & Ring
        </button>
        <span className="slf-label">Your name</span>
        <div className="slf-card" style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <input className="slf-input" style={{ fontFamily: "Inter", fontSize: 15 }} value={name}
            onChange={(e) => setName(e.target.value)} placeholder="e.g. Rayan" />
          <button className="slf-btn slf-btn-teal" onClick={() => onSaveUserName(name.trim())}>Save</button>
        </div>
        <span className="slf-label">Bodyweight ({config.unit})</span>
        <div className="slf-card" style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <input className="slf-input" type="number" value={bw} onChange={(e) => setBw(e.target.value)} />
          <button className="slf-btn slf-btn-teal" onClick={() => onSaveBodyweight(bw)}>Save</button>
        </div>
        <span className="slf-label">Units</span>
        <div className="slf-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 14 }}>Weight unit</div>
          <button className="slf-btn slf-btn-ghost" onClick={onToggleUnit}>
            {config.unit === "kg" ? "kg → switch to lb" : "lb → switch to kg"}
          </button>
        </div>
        <span className="slf-label">Next-session reminder</span>
        <div className="slf-card" style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: "var(--steel)", marginBottom: 12 }}>
            Show a reminder on the dashboard after this many days without a session.
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {[2, 3, 5, 7].map((d) => (
              <button key={d} className="slf-btn" style={{
                padding: "8px 14px", fontSize: 12,
                background: Number(reminderDays) === d ? "var(--gold)" : "transparent",
                color: Number(reminderDays) === d ? "#151310" : "var(--text)",
                border: "1px solid var(--border)",
              }} onClick={() => setReminderDays(d)}>{d}d</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <input className="slf-input" type="number" value={reminderDays} onChange={(e) => setReminderDays(e.target.value)} />
            <button className="slf-btn slf-btn-teal" onClick={() => onSaveReminderDays(reminderDays)}>Save</button>
          </div>
          <div style={{ height: 1, background: "var(--border)", margin: "18px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {config.notificationsEnabled ? <Bell size={16} color="var(--gold)" /> : <BellOff size={16} color="var(--steel)" />}
              <div style={{ fontSize: 14 }}>Browser notifications</div>
            </div>
            <button className="slf-btn slf-btn-ghost" disabled={!notifSupported || notifBlocked}
              onClick={() => onSetNotificationsEnabled(!config.notificationsEnabled)}
              style={{ padding: "8px 14px", fontSize: 12, opacity: !notifSupported || notifBlocked ? 0.4 : 1 }}>
              {config.notificationsEnabled ? "Turn off" : "Turn on"}
            </button>
          </div>
          <p style={{ color: "var(--steel)", fontSize: 11, marginBottom: 0 }}>
            {notifBlocked ? "Notifications are blocked for this site in your browser settings."
              : "Only fires while this tab is open — the dashboard reminder above works either way."}
          </p>
        </div>
        <span className="slf-label">Lifts</span>
        {names.map((n) => (
          <div key={n} className="slf-card" style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{n}</div>
              <button className="slf-btn" style={{ background: "none", color: "#d16a6a", padding: 4 }} onClick={() => onRemoveExercise(n)}><Trash2 size={16} /></button>
            </div>
            <span className="slf-label">1RM formula</span>
            <select className="slf-input" style={{ fontFamily: "Inter", fontSize: 13 }}
              value={exData[n].formula} onChange={(e) => onFormulaOverride(n, e.target.value)}>
              <option value="average">Average of all seven</option>
              {FORMULAS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        ))}
        <button className="slf-btn slf-btn-ghost" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 }}
          onClick={onAddExercise}><Plus size={16} /> Add another lift</button>
      </div>
    </div>
  );
}

/* ───────────────────────── Bottom Nav ───────────────────────── */

function BottomNav({ screen, onNav }) {
  const items = [
    { id: "dashboard",       label: "Dashboard", icon: Home },
    { id: "logPicker",       label: "Log",       icon: PenSquare },
    { id: "stats",           label: "Stats",     icon: BarChart3 },
    { id: "exerciseLibrary", label: "Library",   icon: Dumbbell },
    { id: "settings",        label: "Settings",  icon: SettingsIcon },
  ];
  const LOG_GROUP = ["logPicker", "categoryPicker", "logSession", "goalSetup", "weeklyPlan", "warmupScreen", "workoutSession"];
  return (
    <nav className="slf-navbar">
      {items.map((it) => {
        const Icon = it.icon;
        const active = it.id === "logPicker" ? LOG_GROUP.includes(screen) : screen === it.id;
        return (
          <button key={it.id} className={`slf-navitem ${active ? "active" : ""}`} onClick={() => onNav(it.id)}>
            <Icon size={19} />{it.label}
          </button>
        );
      })}
    </nav>
  );
}