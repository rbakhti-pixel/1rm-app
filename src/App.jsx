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
  {
    id: "brzycki",
    name: "Brzycki",
    calc: (g, r) => (r >= 37 ? g * 2 : g * (36 / (37 - r))),
  },
  { id: "epley", name: "Epley", calc: (g, r) => g * (1 + r / 30) },
  {
    id: "mayhew",
    name: "Mayhew",
    calc: (g, r) => (100 * g) / (52.2 + 41.9 * Math.exp(-0.055 * r)),
  },
  { id: "oconner", name: "O'Conner", calc: (g, r) => g * (1 + 0.025 * r) },
  {
    id: "wathan",
    name: "Wathan",
    calc: (g, r) => (100 * g) / (48.8 + 53.8 * Math.exp(-0.075 * r)),
  },
  {
    id: "lander",
    name: "Lander",
    calc: (g, r) => (100 * g) / (101.3 - 2.67123 * r),
  },
];

const WARMUP_SCHEME = [
  { pct: 0.5, reps: 6 },
  { pct: 0.65, reps: 4 },
  { pct: 0.8, reps: 3 },
];

const CATEGORIES = [
  {
    id: "strength",
    label: "Strength",
    min: 85,
    max: 95,
    color: "var(--gold)",
    repOptions: [1, 2, 3, 4, 5],
    defaultReps: 4,
    defaultSets: 5,
  },
  {
    id: "endurance",
    label: "Endurance",
    min: 65,
    max: 80,
    color: "var(--teal)",
    repOptions: [6, 7, 8, 10, 12],
    defaultReps: 6,
    defaultSets: 4,
  },
  {
    id: "resistance",
    label: "Resistance",
    min: 20,
    max: 50,
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

function repFactor(formulaId, r) {
  return calc1RM(formulaId, 1, r);
}

function roundWeight(w, unit) {
  const inc = unit === "lb" ? 2.5 : 1.25;
  return Math.round(w / inc) * inc;
}

function fmt(n) {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return Math.round(n * 10) / 10;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const KG_TO_LB = 2.20462;
const DEFAULT_REMINDER_DAYS = 3;
const REP_MAX_TABLE_MAX = 7;

function percentToWeight(pct, oneRM, unit) {
  return Math.max(0, roundWeight(((Number(pct) || 0) * (oneRM || 0)) / 100, unit));
}

function weightToPercent(weight, oneRM) {
  if (!oneRM) return 0;
  return Math.round((Number(weight) || 0) / oneRM * 100);
}

function getWarmupSets(targetAdded, unit) {
  if (targetAdded === undefined || targetAdded === null || isNaN(targetAdded)) return [];
  return WARMUP_SCHEME.map((s, i) => {
    const weight = targetAdded * s.pct;
    return {
      id: i,
      reps: s.reps,
      weight: Math.max(0, roundWeight(weight, unit)),
    };
  });
}

function getRepMaxTable(data, bodyweight, unit, maxReps = REP_MAX_TABLE_MAX) {
  if (!data || !data.oneRM) return [];
  const totalOneRM = data.totalOneRM != null ? data.totalOneRM : data.oneRM;
  const bw = data.isBodyweight ? Number(bodyweight) || 0 : 0;
  const rows = [];
  for (let r = 1; r <= maxReps; r++) {
    const factor = repFactor(data.formula, r);
    if (!factor) continue;
    const totalLoad = totalOneRM / factor;
    const added = Math.max(0, roundWeight(totalLoad - bw, unit));
    rows.push({
      reps: r,
      weight: added,
      percent: weightToPercent(added, data.oneRM),
    });
  }
  return rows;
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
  while (weeks.has(cursor)) {
    current++;
    cursor = addDays(cursor, -7);
  }
  const sorted = Array.from(weeks).sort();
  let best = 0;
  let run = 0;
  let prev = null;
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

async function loadConfig() {
  try {
    const r = await window.storage.get("app:config");
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
}
async function saveConfig(cfg) {
  try { await window.storage.set("app:config", JSON.stringify(cfg)); }
  catch (e) { console.error("save config failed", e); }
}
async function loadExercise(name) {
  try {
    const r = await window.storage.get("ex:" + name);
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
}
async function saveExercise(name, data) {
  try { await window.storage.set("ex:" + name, JSON.stringify(data)); }
  catch (e) { console.error("save exercise failed", e); }
}
async function deleteExerciseStorage(name) {
  try { await window.storage.delete("ex:" + name); } catch (e) { /* ignore */ }
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
    .slf-topbar {
      display: flex; align-items: center; gap: 12px; padding: 20px 20px 0 20px;
    }
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
    .slf-heat-grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 4px;
    }
    .slf-heat-col { display: flex; flex-direction: column; gap: 4px; }
    .slf-heat-cell {
      width: 100%; aspect-ratio: 1; border-radius: 3px; background: var(--border);
    }
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
    .slf-cat-chip {
      flex: 1; padding: 14px 10px; border-radius: 14px; text-align: center;
      border: 1px solid var(--border); cursor: pointer; background: transparent;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
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

    /* ── category section divider ── */
    .slf-section-divider {
      display: flex; align-items: center; gap: 10px; margin: 22px 0 16px;
    }
    .slf-section-divider::before, .slf-section-divider::after {
      content: ''; flex: 1; height: 1px; background: var(--border);
    }

    /* ── glass buttons ── */
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
    .slf-stepper-btn:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

    /* ── premium category cards ── */
    .slf-cat-card {
      position: relative; border-radius: 20px; padding: 20px;
      cursor: pointer; margin-bottom: 12px; overflow: hidden;
      transition: transform 0.18s ease, box-shadow 0.18s ease;
    }
    .slf-cat-card:hover  { transform: translateY(-3px); }
    .slf-cat-card:active { transform: translateY(-1px); }
    .slf-stat-tile {
      flex: 1; background: rgba(0,0,0,0.25); border-radius: 12px;
      padding: 10px 12px; backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }
    .slf-stat-tile-accent {
      flex: 1.4; border-radius: 12px; padding: 10px 12px;
    }
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

function WarmupCard({ targetWeight, unit, isBodyweight }) {
  const sets = getWarmupSets(targetWeight, unit);
  if (sets.length === 0) return null;
  return (
    <div className="slf-card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="slf-label" style={{ margin: 0 }}>Warm-up</span>
        <span className="slf-chip">before working sets</span>
      </div>
      {sets.map((s, i) => (
        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
          <span className="slf-mono" style={{ fontSize: 12, color: "var(--steel)" }}>SET {i + 1}</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            {fmt(s.weight)} {unit}{isBodyweight ? " added" : ""} × {s.reps}
          </span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0 0" }}>
        <span className="slf-mono" style={{ fontSize: 12, color: "var(--gold)" }}>THEN WORK SETS</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: "var(--gold)" }}>
          {fmt(targetWeight)} {unit}{isBodyweight ? " added" : ""}
        </span>
      </div>
    </div>
  );
}

function RepMaxTable({ data, bodyweight, unit, activePercent }) {
  const rows = useMemo(() => getRepMaxTable(data, bodyweight, unit), [data, bodyweight, unit]);
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
      <span className="slf-label" style={{ margin: 0, marginBottom: 12, display: "block" }}>Rep max chart</span>
      <table className="slf-rmtable">
        <thead>
          <tr><th>RM</th><th>%</th><th>Weight</th></tr>
        </thead>
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
        osc.connect(gain);
        gain.connect(ctx.destination);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSeconds]);

  // Auto-start whenever a set is checked off
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setTimeLeft(duration); setRunning(true); setDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  useEffect(() => {
    if (!running) return;
    if (timeLeft <= 0) {
      setRunning(false); setDone(true); beep();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [running, timeLeft, beep]);

  const adjust = (delta) => {
    setDuration((d) => Math.max(15, d + delta));
    if (!running) setTimeLeft((t) => Math.max(0, t + delta));
  };
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
          {!running && !done && !paused && (
            <button className="slf-btn slf-btn-teal" style={{ padding: "6px 12px", fontSize: 11 }} onClick={start}>Start</button>
          )}
          {running && (
            <button className="slf-btn slf-btn-ghost" style={{ padding: "6px 12px", fontSize: 11 }} onClick={pause}>Pause</button>
          )}
          {paused && (
            <button className="slf-btn slf-btn-teal" style={{ padding: "6px 12px", fontSize: 11 }} onClick={resume}>Resume</button>
          )}
          {(done || paused) && (
            <button className="slf-btn slf-btn-glass" style={{ padding: "6px 12px", fontSize: 11 }} onClick={reset}>Reset</button>
          )}
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
        setConfig(cfg);
        setExData(map);
        setScreen("dashboard");
      } else {
        setConfig(cfg || { bodyweight: null, unit: "kg", exercisesList: [], onboarded: false });
        setScreen("welcome");
      }
      setReady(true);
    })();
  }, []);

  const nav = useCallback((s, p = {}) => { setParams(p); setScreen(s); }, []);

  const persistConfig = useCallback(async (next) => {
    setConfig(next);
    await saveConfig(next);
  }, []);

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

  const submitTest = useCallback(async ({ name, isBodyweight, formulaId, weightInput, reps, isNew, bodyweightInput }) => {
    let cfg = config;
    if (bodyweightInput) cfg = { ...cfg, bodyweight: Number(bodyweightInput) };
    const bodyweight = Number(cfg.bodyweight) || 0;
    const g = Number(weightInput);
    const totalInput = isBodyweight ? g + bodyweight : g;
    const totalOneRM = calc1RM(formulaId, totalInput, Number(reps));
    const oneRM = isBodyweight ? Math.max(0, totalOneRM - bodyweight) : totalOneRM;
    const test = { id: uid(), date: todayStr(), weightInput: Number(weightInput), reps: Number(reps), formula: formulaId, result: oneRM };

    let data = exData[name];
    if (isNew || !data) {
      data = { name, isBodyweight, formula: formulaId, oneRM, totalOneRM, tests: [test], sessions: [] };
      const nextList = Array.from(new Set([...(cfg.exercisesList || []), name]));
      cfg = { ...cfg, exercisesList: nextList, onboarded: true };
      await persistConfig(cfg);
    } else {
      data = { ...data, formula: formulaId, oneRM, totalOneRM, tests: [...data.tests, { ...test }] };
      if (bodyweightInput) await persistConfig(cfg);
    }
    await persistExercise(name, data);
    nav("testResult", { name, result: oneRM, isBodyweight });
  }, [config, exData, persistConfig, persistExercise, nav]);

  const logSession = useCallback(async ({ name, category, percent, weightUsed, setsCompleted, repsCompleted, rpe, notes }) => {
    const data = exData[name];
    if (!data) return;
    const session = {
      id: uid(), date: todayStr(), category: category || null,
      percent: percent != null ? Number(percent) : null,
      weightUsed: Number(weightUsed), setsCompleted: Number(setsCompleted),
      repsCompleted: Number(repsCompleted), rpe: rpe === "" ? null : Number(rpe), notes: notes || "",
    };
    await persistExercise(name, { ...data, sessions: [...data.sessions, session] });
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

  const updateBodyweight = useCallback(async (bw) => {
    await persistConfig({ ...config, bodyweight: Number(bw) });
  }, [config, persistConfig]);

  const updateReminderDays = useCallback(async (days) => {
    await persistConfig({ ...config, reminderDays: Math.max(1, Number(days) || DEFAULT_REMINDER_DAYS) });
  }, [config, persistConfig]);

  const updateUserName = useCallback(async (name) => {
    await persistConfig({ ...config, userName: name });
  }, [config, persistConfig]);

  const setNotificationsEnabled = useCallback(async (enabled) => {
    if (enabled && typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    await persistConfig({ ...config, notificationsEnabled: enabled });
  }, [config, persistConfig]);

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
        }} />
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
          onOpenStats={() => nav("stats")} />
      )}
      {screen === "exerciseDetail" && (
        <ExerciseDetail name={params.name} data={exData[params.name]} unit={config.unit}
          onBack={() => nav("dashboard")}
          onStartSession={() => nav("categoryPicker", { name: params.name })}
          onRetest={() => nav("testInput", { name: params.name, isBodyweight: exData[params.name].isBodyweight, formulaId: exData[params.name].formula, isNew: false })}
          onDeleteTest={(id) => deleteLogItem(params.name, "test", id)}
          onDeleteSession={(id) => deleteLogItem(params.name, "session", id)}
          onEditSession={(id, patch) => editSession(params.name, id, patch)} />
      )}
      {screen === "logPicker" && (
        <LogPicker exData={exData}
          onPick={(name) => nav("categoryPicker", { name, from: "logPicker" })}
          onAddExercise={() => nav("exercisePicker", { isNew: true })} />
      )}
      {screen === "categoryPicker" && (
        <CategoryPicker
          name={params.name}
          data={exData[params.name]}
          unit={config.unit}
          onBack={() => params.from === "logPicker" ? nav("logPicker") : nav("exerciseDetail", { name: params.name })}
          onPick={(category) => nav("logSession", { name: params.name, from: params.from, category })}
        />
      )}

      {screen === "logSession" && (
        <LogSession
          name={params.name}
          data={exData[params.name]}
          unit={config.unit}
          bodyweight={config.bodyweight}
          category={params.category}
          from={params.from}
          onBack={() => nav("categoryPicker", { name: params.name, from: params.from })}
          onStartWorkout={(wp) => nav("workoutSession", { name: params.name, from: params.from, ...wp })}
        />
      )}
      {screen === "workoutSession" && (
        <WorkoutSession
          name={params.name}
          data={exData[params.name]}
          unit={config.unit}
          bodyweight={config.bodyweight}
          category={params.category}
          percent={params.percent}
          weight={params.weight}
          targetSets={params.targetSets}
          targetReps={params.targetReps}
          from={params.from}
          onBack={() => nav("logSession", { name: params.name, from: params.from, category: params.category })}
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
          onSaveUserName={updateUserName} />
      )}
      {screen === "about" && (
        <AboutScreen
          onBack={() => nav(onboarded ? "dashboard" : "welcome")}
          onStart={() => nav("dashboard")}
        />
      )}
      {onboarded && ["dashboard","exerciseDetail","categoryPicker","logSession","workoutSession","logPicker","history","stats","settings","about"].includes(screen) && (
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
    image: new URL("../images.jpg", import.meta.url).href,
    description: "Start by testing a lift to estimate your one-rep max and unlock a personalized plan.",
  },
  {
    id: "slide2",
    title: "Build your peak",
    image: new URL("../images2.jpg", import.meta.url).href,
    description: "Choose a goal, frequency, and safe pace so the plan fits your schedule and progress.",
  },
  {
    id: "slide3",
    title: "Track every workout",
    image: new URL("../images3.jpg", import.meta.url).href,
    description: "Log sessions, follow percentages, and watch your strength improve over time.",
  },
  {
    id: "slide4",
    title: "Ready to begin",
    image: new URL("../images5.jpg", import.meta.url).href,
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

function Welcome({ onBegin }) {
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
      </div>
    </div>
  );
}

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
  const needsBodyweight = isBodyweight && !config.bodyweight;
  const [bwInput, setBwInput] = useState(config.bodyweight ? String(config.bodyweight) : "");
  const repsNum = Number(reps);
  const repsValid = reps !== "" && repsNum >= 1 && repsNum <= 12;
  const bwValid = !needsBodyweight || (bwInput !== "" && Number(bwInput) > 0);
  const canSubmit = weightInput && repsValid && bwValid;

  return (
    <div className="slf-fade">
      <TopBar title={isNew ? "New 1RM test" : "Retest 1RM"} onBack={onBack} />
      <div className="slf-scroll">
        <div className="slf-card">
          <div style={{ marginBottom: 16 }}>
            <span className="slf-label">{name}</span>
            <span className="slf-chip gold">{formulaId === "average" ? "average of 7" : FORMULAS.find((f) => f.id === formulaId)?.name}</span>
          </div>
          {needsBodyweight && (
            <>
              <span className="slf-label">Your bodyweight ({config.unit})</span>
              <input className="slf-input" type="number" inputMode="decimal" style={{ marginBottom: 8 }}
                value={bwInput} onChange={(e) => setBwInput(e.target.value)} placeholder="0" />
              <p style={{ color: "var(--steel)", fontSize: 12, marginBottom: 16 }}>
                Needed once — {name} moves your bodyweight plus the added load, so the 1RM formula is run on that total, then converted back to an added-weight target.
              </p>
            </>
          )}
          <span className="slf-label">{isBodyweight ? `Added weight (${config.unit})` : `Weight lifted (${config.unit})`}</span>
          <input className="slf-input" type="number" inputMode="decimal" style={{ marginBottom: 16 }}
            value={weightInput} onChange={(e) => setWeightInput(e.target.value)} placeholder="0" />
          <span className="slf-label">Reps performed</span>
          <input className="slf-input" type="number" inputMode="numeric" value={reps}
            onChange={(e) => setReps(e.target.value)} placeholder="1–12" />
          {reps !== "" && !repsValid && (
            <p style={{ color: "#d16a6a", fontSize: 12, marginTop: 8 }}>Formulas break down outside 1–12 reps.</p>
          )}
          {isBodyweight && !needsBodyweight && (
            <p style={{ color: "var(--steel)", fontSize: 12, marginTop: 12 }}>
              Your bodyweight ({fmt(config.bodyweight)} {config.unit}) is added to this load before calculating, then subtracted back out.
            </p>
          )}
          <button className="slf-btn slf-btn-primary" style={{ width: "100%", marginTop: 18 }}
            disabled={!canSubmit}
            onClick={() => onSubmit({ name, isBodyweight, formulaId, weightInput, reps, isNew, bodyweightInput: needsBodyweight ? bwInput : undefined })}>
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

function Dashboard({ config, exData, onOpenExercise, onAddExercise, onOpenStats }) {
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
        {config.userName && (
          <div className="slf-display" style={{ fontSize: 19, marginBottom: 16 }}>Hi {config.userName}, keep going</div>
        )}
        <ReminderBanner exData={exData} reminderDays={config.reminderDays || DEFAULT_REMINDER_DAYS} streak={streak} />
        <div className="slf-card slf-exlist-item" style={{ marginBottom: 16, cursor: "pointer" }} onClick={onOpenStats}>
          <StreakBadge current={streak.current} best={streak.best} />
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
          <ExerciseCard key={n} data={exData[n]} unit={config.unit} onClick={() => onOpenExercise(n)} />
        ))}
      </div>
    </div>
  );
}

function ExerciseCard({ data, unit, onClick }) {
  const lastSession = data.sessions.length ? data.sessions[data.sessions.length - 1] : null;
  return (
    <div className="slf-exlist-item" style={{ alignItems: "center" }} onClick={onClick}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{data.name}</div>
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
      <ChevronRight size={18} color="var(--steel)" />
    </div>
  );
}

/* ───────────────────────── Exercise Detail ───────────────────────── */

function ExerciseDetail({ name, data, unit, onBack, onStartSession, onRetest, onDeleteTest, onDeleteSession, onEditSession }) {
  if (!data) return null;
  const chartData = data.tests.map((t, i) => ({ label: `T${i + 1}`, value: Math.round(t.result * 10) / 10, date: t.date }));

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
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="slf-btn slf-btn-primary" style={{ flex: 1 }} onClick={onStartSession}>Log a session</button>
          <button className="slf-btn slf-btn-ghost" style={{ flex: 1 }} onClick={onRetest}>Retest 1RM</button>
        </div>
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

function LogPicker({ exData, onPick, onAddExercise }) {
  const names = Object.keys(exData);
  if (names.length === 0) {
    return (
      <div className="slf-fade">
        <TopBar title="Log a session" />
        <div className="slf-scroll">
          <EmptyState icon={<PenSquare size={28} />} title="No lifts yet" sub="Add a lift first to log sessions against it."
            action="Add your first lift" onAction={onAddExercise} />
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
          return (
            <div key={n} className="slf-exlist-item" onClick={() => onPick(n)}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{n}</div>
                <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 3 }}>1RM {fmt(d.oneRM)}</div>
              </div>
              <ChevronRight size={18} color="var(--steel)" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── Category Picker ───────────────────────── */

function CategoryPicker({ name, data, unit, onBack, onPick }) {
  const oneRM = data ? data.oneRM || 0 : 0;

  return (
    <div className="slf-fade">
      <TopBar title={`Log · ${name}`} onBack={onBack} />
      <div className="slf-scroll">

        {/* 1RM context strip */}
        <div className="slf-hero" style={{ display: "flex", alignItems: "center", gap: 18, padding: "20px", marginBottom: 24 }}>
          <Gauge value={1} max={1} size={72} strokeWidth={7} color="var(--gold)" centerBig={fmt(oneRM)} centerSmall={unit} />
          <div>
            <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>CURRENT 1RM · {name.toUpperCase()}</div>
            <div className="slf-display" style={{ fontSize: 22, marginTop: 2 }}>{fmt(oneRM)} {unit}</div>
            <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 2 }}>
              {data?.isBodyweight ? "added weight" : "barbell weight"}
            </div>
          </div>
        </div>

        <span className="slf-label">What are you training today?</span>
        <p style={{ color: "var(--steel)", fontSize: 13, marginBottom: 20, marginTop: -2 }}>
          Pick a category — each one is set up with the right load and reps for that training goal.
        </p>

        {CATEGORIES.map((cat) => {
          const midPct = categoryMidpoint(cat);
          const midWeight = percentToWeight(midPct, oneRM, unit);
          return (
            <div
              key={cat.id}
              className="slf-hero slf-exlist-item"
              style={{ cursor: "pointer", marginBottom: 10, gap: 18, padding: "18px 20px" }}
              onClick={() => onPick(cat.id)}
            >
              <div style={{ flex: 1 }}>
                <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)", marginBottom: 6 }}>
                  {cat.min}–{cat.max}% OF 1RM
                </div>
                <div className="slf-display" style={{ fontSize: 32, color: cat.color, lineHeight: 1.05, marginBottom: 6 }}>
                  {cat.label}
                </div>
                <div style={{ fontSize: 15, color: "var(--text)", fontWeight: 600, marginBottom: 4 }}>
                  {oneRM > 0 ? `${fmt(midWeight)} ${unit}` : `${midPct}%`}
                </div>
                <div style={{ fontSize: 12, color: "var(--steel)" }}>
                  {cat.defaultSets} sets · {cat.repOptions[0]}–{cat.repOptions[cat.repOptions.length - 1]} reps
                </div>
              </div>
              <ChevronRight size={18} color="var(--steel)" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── LogSession — Planning screen ───────────────────────── */
/* Shows: % counter + RM table + reps. User taps "Start Workout" to proceed.       */

function LogSession({ name, data, unit, bodyweight, category: initialCategory, from, onBack, onStartWorkout }) {
  const oneRM = data ? data.oneRM || 0 : 0;

  // Seed everything from the category chosen on the previous screen
  const seedCat = CATEGORIES.find((c) => c.id === initialCategory) || null;
  const seedPct = seedCat ? categoryMidpoint(seedCat) : 80;
  const seedWeight = percentToWeight(seedPct, oneRM, unit);
  const seedSets = seedCat ? seedCat.defaultSets : 5;
  const seedReps = seedCat ? seedCat.defaultReps : 5;

  // ── category / % / weight state ──
  const [category, setCategory] = useState(initialCategory || null);
  const [percent, setPercent] = useState(seedPct);
  const [weight, setWeight] = useState(seedWeight);

  // ── sets / reps ──
  const [targetSets, setTargetSets] = useState(seedSets);
  const [targetReps, setTargetReps] = useState(seedReps);

  if (!data) return null;

  const activeCategory = CATEGORIES.find((c) => c.id === category);

  /* ── handlers ── */

  const pickCategory = (cat) => {
    const mid = categoryMidpoint(cat);
    const w = percentToWeight(mid, oneRM, unit);
    setCategory(cat.id);
    setPercent(mid);
    setWeight(w);
    setTargetSets(cat.defaultSets);
    setTargetReps(cat.defaultReps);
  };

  const stepPercent = (delta) => {
    setCategory(null);
    const next = Math.max(0, Math.min(100, percent + delta));
    const w = percentToWeight(next, oneRM, unit);
    setPercent(next);
    setWeight(w);
  };

  const onWeightChange = (rawVal) => {
    setCategory(null);
    setWeight(rawVal);
    setPercent(weightToPercent(rawVal, oneRM));
  };

  /* ── render ── */

  return (
    <div className="slf-fade">
      <TopBar title={`Log · ${name}`} onBack={onBack} />
      <div className="slf-scroll">

        {/* Category context badge */}
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

        {/* ── % stepper ── */}
        <div className="slf-hero" style={{ padding: "22px 18px", textAlign: "center", marginBottom: 14 }}>
          <div className="slf-mono" style={{ fontSize: 11, color: "var(--steel)", marginBottom: 10 }}>
            {category ? `${activeCategory?.label.toUpperCase()} · ` : "MANUAL · "}% OF 1RM
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

        {/* Direct weight override */}
        <div className="slf-card" style={{ marginBottom: 14 }}>
          <span className="slf-label">Or enter the weight directly ({unit})</span>
          <input className="slf-input" type="number" inputMode="decimal" value={weight}
            onChange={(e) => onWeightChange(e.target.value)} />
          <p style={{ color: "var(--steel)", fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            Editing weight updates the % above, and vice versa.
          </p>
        </div>

        {/* Reps quick-pick */}
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
                }}
                  onClick={() => setTargetReps(r)}>{r}</button>
              ))}
            </div>
            <p style={{ color: "var(--steel)", fontSize: 11, marginTop: 8, marginBottom: 0 }}>
              {activeCategory.id === "strength" && "Heavy singles to fives — maximal strength zone."}
              {activeCategory.id === "endurance" && "Moderate reps, moderate load — hypertrophy sweet spot."}
              {activeCategory.id === "resistance" && "High reps, light load — builds work capacity."}
            </p>
          </div>
        )}

        {/* RM table */}
        {(!activeCategory || activeCategory.id !== "resistance") && (
          <RepMaxTable data={data} bodyweight={bodyweight} unit={unit} activePercent={percent} />
        )}

        {/* Start Workout button */}
        <button className="slf-btn slf-btn-primary" style={{ width: "100%", marginTop: 8 }}
          onClick={() => onStartWorkout({ category, percent, weight, targetSets, targetReps })}>
          Start Workout
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── WorkoutSession — Execution screen ───────────────────────── */
/* Warmup → set checklist → rest timer → log form                                      */

function WorkoutSession({ name, data, unit, bodyweight, category, percent, weight, targetSets, targetReps, onBack, onSubmit }) {
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

        {/* Header: planned weight + target */}
        <div className="slf-hero" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px", marginBottom: 14 }}>
          <div>
            <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>WORKING WEIGHT</div>
            <div className="slf-display" style={{ fontSize: 30 }}>{fmt(weight)} {unit}{data.isBodyweight ? " added" : ""}</div>
            <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 4 }}>{percent}% of 1RM</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="slf-mono" style={{ fontSize: 10, color: "var(--steel)" }}>TARGET</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{targetSets} × {targetReps}</div>
            {activeCategory && (
              <span className={`slf-chip ${category === "strength" ? "gold" : category === "endurance" ? "teal" : ""}`}
                style={{ marginTop: 6, display: "inline-flex" }}>{activeCategory.label}</span>
            )}
          </div>
        </div>

        {/* Warm-up */}
        <WarmupCard targetWeight={weight} unit={unit} isBodyweight={data.isBodyweight} />

        {/* Set checklist */}
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

        {/* Rest timer — auto-starts on each set check-off */}
        <RestTimer defaultSeconds={120} triggerKey={restTrigger} />

        {/* Section divider */}
        <div className="slf-section-divider">
          <span className="slf-mono" style={{ fontSize: 10, color: "var(--steel)", whiteSpace: "nowrap" }}>LOG YOUR RESULTS</span>
        </div>

        {/* Log form */}
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
            onClick={() => onSubmit({ name, category, percent, weightUsed, setsCompleted, repsCompleted, rpe, notes })}>
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
  const [sets, setSets] = useState(String(item.setsCompleted));
  const [reps, setReps] = useState(String(item.repsCompleted));
  const [rpe, setRpe] = useState(item.rpe ? String(item.rpe) : "");
  const [notes, setNotes] = useState(item.notes || "");
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
          <EmptyState icon={<BarChart3 size={28} />} title="Nothing to show yet" sub="Log your first session to start building a streak and a tonnage trend." />
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span className="slf-label" style={{ margin: 0 }}>Weekly tonnage</span>
        </div>
        <p style={{ color: "var(--steel)", fontSize: 12, marginTop: -4, marginBottom: 12 }}>
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

/* ───────────────────────── Settings ───────────────────────── */

function SettingsScreen({ config, exData, onSaveBodyweight, onToggleUnit, onFormulaOverride, onRemoveExercise, onAddExercise, onSaveReminderDays, onSetNotificationsEnabled, onSaveUserName }) {
  const [bw, setBw] = useState(config.bodyweight || "");
  const [reminderDays, setReminderDays] = useState(config.reminderDays || DEFAULT_REMINDER_DAYS);
  const [name, setName] = useState(config.userName || "");
  const notifSupported = typeof Notification !== "undefined";
  const notifBlocked = notifSupported && Notification.permission === "denied";
  const names = Object.keys(exData);

  return (
    <div className="slf-fade">
      <TopBar title="Settings" />
      <div className="slf-scroll">
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
            {notifBlocked
              ? "Notifications are blocked for this site in your browser settings."
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
  const LOG_GROUP = ["logPicker", "categoryPicker", "logSession", "workoutSession"];
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