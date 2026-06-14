import { useState, useRef, useEffect } from "react";
import React from "react";

// ── Timezone: hora de Lima (UTC-5) ────────────────────────────
function getLimaDate() {
  const lima = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return lima.toISOString().slice(0, 10);
}
function getLimaDateOffset(offsetDays) {
  const lima = new Date(Date.now() - 5 * 60 * 60 * 1000);
  lima.setDate(lima.getDate() + offsetDays);
  return lima.toISOString().slice(0, 10);
}
// La "noche" pertenece al día que empezó (7pm → 6am)
// Si son las 12am-6am Lima, los despertares son de la noche anterior
function getNightDate() {
  const lima = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const hour = lima.getHours();
  // Entre medianoche y las 6am → la noche pertenece al día anterior
  if (hour < 6) {
    lima.setDate(lima.getDate() - 1);
  }
  return lima.toISOString().slice(0, 10);
}

// ── localStorage helpers ──────────────────────────────────────
function loadDay(dateStr) {
  try {
    const raw = localStorage.getItem(`camille-${dateStr}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}
function saveDay(dateStr, data) {
  try {
    localStorage.setItem(`camille-${dateStr}`, JSON.stringify(data));
  } catch {}
}

// ── Error Boundary ────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return (
      <div style={{ padding: 32, textAlign: "center", fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 48 }}>😴</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 16, color: "#111827" }}>Algo salió mal</div>
        <div style={{ fontSize: 14, color: "#6B7280", marginTop: 8 }}>Toca el botón para recargar</div>
        <button onClick={() => window.location.reload()} style={{
          marginTop: 20, padding: "12px 24px", background: "#7C4DFF",
          color: "white", border: "none", borderRadius: 12, fontSize: 15,
          fontWeight: 700, cursor: "pointer", fontFamily: "sans-serif",
        }}>🔄 Recargar</button>
      </div>
    );
    return this.props.children;
  }
}
function CamilleNapsWrapped() {
  return <ErrorBoundary><CamilleNaps /></ErrorBoundary>;
}

// ── Constantes ────────────────────────────────────────────────
const WINDOWS = [
  { label: "Siesta 1", windowMin: 180, color: "#00BCD4" },
  { label: "Siesta 2", windowMin: 220, color: "#43A047" },
  { label: "Noche",    windowMin: 180, color: "#7C4DFF" },
];
const ROUTINE_MIN = 30;
const TODAY = getLimaDate();
const NIGHT_DATE = getNightDate();
const EMPTY_NAPS = [
  { asleepAt: null, wokeAt: null, long: null, didNotHappen: false, timeToFallAsleep: null },
  { asleepAt: null, wokeAt: null, long: null, didNotHappen: false, timeToFallAsleep: null },
];
const EMPTY_NIGHT = { wakings: [] };
const DEFAULT_DAY = { wakeTime: "06:00", naps: EMPTY_NAPS, bedAsleep: null };

// ── Helper functions ──────────────────────────────────────────
function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total/60)%24).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
}
function diffMinutes(a, b) {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return (bh * 60 + bm) - (ah * 60 + am);
}
function formatTime(t) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}
function timeToMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ── Main Component ────────────────────────────────────────────
export default CamilleNapsWrapped;
function CamilleNaps() {
  const [view, setView] = useState("nanny");
  const [viewingDate, setViewingDate] = useState("today");
  // ── Modo siesta ───────────────────────────────────────────────
  // napMode: "two" | "one"
  const [napMode, setNapMode] = useState(() => {
    try { return localStorage.getItem("camille-napMode") || "one"; } catch { return "one"; }
  });
  function setNapModePersist(m) {
    setNapMode(m);
    try { localStorage.setItem("camille-napMode", m); } catch {}
  }
  // One-nap progression: objetivo dormida (en minutos desde medianoche)
  const [onNapTargetMin, setOnNapTargetMinRaw] = useState(() => {
    try { return parseInt(localStorage.getItem("camille-onNapTarget") || String(9*60+30)); } catch { return 9*60+30; }
  });
  function setOnNapTarget(m) {
    setOnNapTargetMinRaw(m);
    try { localStorage.setItem("camille-onNapTarget", String(m)); } catch {}
  }
  const ONE_NAP_MAX_MIN = 12 * 60; // 12:00pm techo
  const ONE_NAP_DUR_TARGET = 120;  // 2h objetivo
  const ONE_NAP_NIGHT_WINDOW = 4 * 60 + 30; // 4h30 desde despertar siesta
  const ONE_NAP_NIGHT_MAX = 18 * 60 + 30;   // 6:30pm máximo noche

  // ── Estado único del día ──────────────────────────────────────
  const [dayData, setDayData] = useState(
    () => loadDay(TODAY) || DEFAULT_DAY
  );
  const wakeTime  = dayData.wakeTime;
  const naps      = dayData.naps;
  const bedAsleep = dayData.bedAsleep;

  // Guardar en localStorage cada vez que cambia
  useEffect(() => { saveDay(TODAY, dayData); }, [dayData]);

  // Setters
  function setWakeTime(val) { setDayData(p => ({ ...p, wakeTime: val })); }
  function setNaps(u) { setDayData(p => ({ ...p, naps: typeof u === "function" ? u(p.naps) : u })); }
  function setBedAsleep(val) { setDayData(p => ({ ...p, bedAsleep: val })); }

  // ── Save flow state ───────────────────────────────────────────
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveDate, setSaveDate] = useState(TODAY);
  // ── Estado de noche con selector de fecha ────────────────────
  const [selectedNightDate, setSelectedNightDate] = useState(NIGHT_DATE);
  const [nightData, setNightDataRaw] = useState(
    () => loadDay(`night-${NIGHT_DATE}`) || EMPTY_NIGHT
  );
  useEffect(() => {
    saveDay(`night-${selectedNightDate}`, nightData);
  }, [nightData]);

  // Cuando cambia la fecha seleccionada, carga esa noche
  useEffect(() => {
    setNightDataRaw(loadDay(`night-${selectedNightDate}`) || EMPTY_NIGHT);
  }, [selectedNightDate]);

  function setNight(val) { setNightDataRaw(val); }

  // ── Ayer ──────────────────────────────────────────────────────
  const [yesterdayData, setYesterdayData] = useState(null);
  useEffect(() => {
    if (viewingDate === "yesterday")
      setYesterdayData(loadDay(getLimaDateOffset(-1)));
  }, [viewingDate]);

  // ── Historial semanal (directo de localStorage) ───────────────
  const weekData = Array.from({ length: 7 }, (_, i) => {
    const dateStr = getLimaDateOffset(-(6 - i));
    const d = loadDay(dateStr);
    const n = loadDay(`night-${dateStr}`);
    return { log_date: dateStr, wake_time: d?.wakeTime, naps: d?.naps, bed_asleep: d?.bedAsleep, night: n };
  });

  // ── Helpers de tiempo ────────────────────────────────────────
  function timeToMin(t) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  // Noche: entrada antes 6:30pm, objetivo dormida 7:00pm, nunca después 7:30pm
  const BEDTIME_CUTOFF_MIN   = 20 * 60;       // 8:00pm — si se pasa, advertir sobre S2
  const BEDTIME_ENTRY_MAX    = 18 * 60 + 30;  // 6:30pm — entrada máxima
  const BEDTIME_TARGET_MAX   = 19 * 60;        // 7:00pm — objetivo dormida
  const BEDTIME_HARD_MAX     = 19 * 60 + 30;  // 7:30pm — nunca después
  const EARLIEST_BED_NORMAL  = 18 * 60 + 30;  // 6:30pm — mínimo con siestas normales
  const EARLIEST_BED_SKIP    = 17 * 60 + 30;  // 5:30pm — mínimo si se cancela S2

  // Compute schedule from wake time + actual nap data
  function getSchedule() {
    const schedule = [];
    let currentWake = wakeTime;

    // ── Siesta 1 ──────────────────────────────────────────────
    const win0 = WINDOWS[0];
    const sleepTarget0 = addMinutes(currentWake, win0.windowMin);
    const enterRoom0   = addMinutes(sleepTarget0, -ROUTINE_MIN);
    const actual0      = naps[0]?.asleepAt;
    const woke0        = naps[0]?.wokeAt;
    const nap1DNH      = naps[0]?.didNotHappen;
    schedule.push({
      label: win0.label, color: win0.color,
      windowMin: win0.windowMin,
      enterRoom: enterRoom0, sleepTarget: sleepTarget0,
      actual: actual0, woke: woke0, long: naps[0]?.long,
      currentWake, skip: false, didNotHappen: nap1DNH,
    });
    // Si no ocurrió siesta 1: currentWake sigue siendo el despertar de mañana
    // la ventana de siesta 2 se calcula desde ese mismo despertar acumulando horas
    if (nap1DNH) {
      // no cambia currentWake — ya lleva el tiempo despierta desde la mañana
    } else if (woke0)        currentWake = woke0;
    else if (actual0) currentWake = addMinutes(actual0, 60);
    else              currentWake = addMinutes(sleepTarget0, 75);

    // ── Siesta 2: ventana óptima basada en datos reales ──────────
    // Óptimo: fin S1 + 2h50m (entrar) → fin S1 + 3h20m (dormida)
    // Techo duro: 1:00pm (13:00)
    const S2_WINDOW_ENTER = 2 * 60 + 50;  // 2h50m desde fin S1
    const S2_WINDOW_SLEEP = 3 * 60 + 20;  // 3h20m desde fin S1
    const S2_MAX_MIN      = 13 * 60;       // 1:00pm techo duro

    let enterRoom1, sleepTarget1, s2Compressed = false;

    if (nap1DNH) {
      // S1 no ocurrió — usar ventana desde despertar mañana
      const windowMin1 = win0.windowMin + WINDOWS[1].windowMin;
      sleepTarget1 = addMinutes(wakeTime, windowMin1);
      enterRoom1   = addMinutes(sleepTarget1, -ROUTINE_MIN);
    } else {
      const s1WakeMin     = timeToMin(currentWake);
      const idealEnterMin = s1WakeMin + S2_WINDOW_ENTER;
      const idealSleepMin = s1WakeMin + S2_WINDOW_SLEEP;

      if (idealEnterMin > S2_MAX_MIN) {
        // S1 terminó tarde — comprimir al techo
        const hh = Math.floor(S2_MAX_MIN / 60);
        const mm = S2_MAX_MIN % 60;
        enterRoom1   = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
        sleepTarget1 = addMinutes(enterRoom1, ROUTINE_MIN);
        s2Compressed = true;
      } else if (idealSleepMin > S2_MAX_MIN + ROUTINE_MIN) {
        // Entrada OK pero dormida pasaría el techo — comprimir solo dormida
        const hh = Math.floor(idealEnterMin / 60);
        const mm = idealEnterMin % 60;
        enterRoom1   = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
        sleepTarget1 = `${String(Math.floor(S2_MAX_MIN/60)).padStart(2,"0")}:${String(S2_MAX_MIN%60).padStart(2,"0")}`;
      } else {
        const hh = Math.floor(idealEnterMin / 60);
        const mm = idealEnterMin % 60;
        enterRoom1   = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
        const sh = Math.floor(idealSleepMin / 60);
        const sm = idealSleepMin % 60;
        sleepTarget1 = `${String(sh).padStart(2,"0")}:${String(sm).padStart(2,"0")}`;
      }
    }

    const windowMin1      = diffMinutes(currentWake, sleepTarget1); // informativo
    const estWake1        = addMinutes(sleepTarget1, 75);
    const win2            = WINDOWS[2];
    const projectedBedMin = timeToMin(addMinutes(estWake1, win2.windowMin));
    const warnNap2        = !nap1DNH && projectedBedMin > BEDTIME_CUTOFF_MIN;

    const actual1 = naps[1]?.asleepAt;
    const woke1   = naps[1]?.wokeAt;
    const nap2DNH = naps[1]?.didNotHappen;
    schedule.push({
      label: WINDOWS[1].label, color: WINDOWS[1].color,
      windowMin: windowMin1,
      enterRoom: enterRoom1, sleepTarget: sleepTarget1,
      actual: actual1, woke: woke1, long: naps[1]?.long,
      currentWake: nap1DNH ? wakeTime : currentWake,
      skip: false, warn: warnNap2, didNotHappen: nap2DNH,
      compressed: s2Compressed,
      projectedBed: addMinutes(estWake1, win2.windowMin),
    });

    if (!warnNap2 && !nap2DNH) {
      if (woke1)        currentWake = woke1;
      else if (actual1) currentWake = addMinutes(actual1, 60);
      else              currentWake = nap1DNH ? addMinutes(wakeTime, windowMin1 + 75) : addMinutes(sleepTarget1, 75);
    }

    // ── Noche ─────────────────────────────────────────────────
    // Entrada antes 6:30pm, objetivo dormida 7:00pm, nunca después 7:30pm
    let sleepTarget2, bedLate = false;

    if (warnNap2 || nap2DNH) {
      // Sin S2: mínimo 5:30pm, ventana de 4h desde último despertar
      const fromWake = addMinutes(currentWake, 4 * 60);
      const finalMin = Math.min(Math.max(timeToMin(fromWake), EARLIEST_BED_SKIP), BEDTIME_HARD_MAX);
      sleepTarget2 = `${String(Math.floor(finalMin/60)).padStart(2,"0")}:${String(finalMin%60).padStart(2,"0")}`;
    } else {
      // Con S2: objetivo 7pm, nunca después de 7:30pm
      const calcMin = timeToMin(addMinutes(currentWake, win2.windowMin));
      if (calcMin > BEDTIME_HARD_MAX) bedLate = true;
      const clampedMin = Math.min(Math.max(calcMin, EARLIEST_BED_NORMAL), BEDTIME_HARD_MAX);
      sleepTarget2 = `${String(Math.floor(clampedMin/60)).padStart(2,"0")}:${String(clampedMin%60).padStart(2,"0")}`;
    }
    const enterRoom2 = addMinutes(sleepTarget2, -ROUTINE_MIN);

    schedule.push({
      label: win2.label, color: win2.color,
      windowMin: win2.windowMin,
      enterRoom: enterRoom2, sleepTarget: sleepTarget2,
      actual: bedAsleep, woke: null, long: null,
      currentWake, skip: false, bedLate,
    });

    return schedule;
  }

  const schedule = getSchedule();

  function recordNapAsleep(i, time) {
    setNaps(prev => {
      const n = [...prev];
      n[i] = { ...n[i], asleepAt: time, didNotHappen: false };
      return n;
    });
  }

  function recordNapWoke(i, time) {
    setNaps(prev => {
      const n = [...prev];
      const asleep = n[i].asleepAt;
      const dur = asleep ? diffMinutes(asleep, time) : 0;
      n[i] = { ...n[i], wokeAt: time, long: dur >= 70 };
      return n;
    });
  }

  function recordTimeToFallAsleep(i, mins) {
    setNaps(prev => {
      const n = [...prev];
      n[i] = { ...n[i], timeToFallAsleep: mins ? parseInt(mins) : null };
      return n;
    });
  }

  function markDidNotHappen(i) {
    setNaps(prev => {
      const n = [...prev];
      n[i] = { asleepAt: null, wokeAt: null, long: null, didNotHappen: true };
      return n;
    });
  }

  function clearNap(i) {
    setNaps(prev => {
      const n = [...prev];
      n[i] = { asleepAt: null, wokeAt: null, long: null, didNotHappen: false };
      return n;
    });
  }


  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      background: "#E8E8EC",
      fontFamily: "'DM Sans', 'Nunito', 'Segoe UI', sans-serif",
      padding: "0 0 40px",
      overflowX: "hidden",
      boxSizing: "border-box",
    }}>
      {/* Header */}
      <div style={{
        background: "white",
        borderBottom: "1px solid #D1D5DB",
        padding: "20px 24px 0",
        position: "sticky",
        top: 0,
        zIndex: 10,
        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
      }}>
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 28 }}>🌙</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#111827", letterSpacing: "-0.5px" }}>
                Camille
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                14 meses · Rastreador de sueño
              </div>
            </div>
          </div>

          {/* Tab switcher */}
          <div style={{ display: "flex", gap: 0, marginTop: 16 }}>
            {[["nanny", "🧸 Lucy"], ["lechucera", "🌙 Mili"], ["coach", "👩 Mamá"]].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} style={{
                flex: 1,
                padding: "10px 0",
                border: "none",
                background: "none",
                borderBottom: view === v ? "3px solid #7C4DFF" : "3px solid transparent",
                color: view === v ? "#7C4DFF" : "#9CA3AF",
                fontWeight: view === v ? 700 : 400,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.2s",
              }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 12px 0" }}>

        {/* ── NANNY VIEW ── */}
        {view === "nanny" && (
          <div>
            {/* Mode toggle */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {[["two", "🛌🛌 Dos siestas"], ["one", "🛌 Una siesta"]].map(([m, label]) => (
                <button key={m} onClick={() => setNapModePersist(m)} style={{
                  flex: 1, padding: "8px 0", border: "2px solid",
                  borderColor: napMode === m ? "#7C4DFF" : "#E5E7EB",
                  borderRadius: 10,
                  background: napMode === m ? "#F5F3FF" : "white",
                  color: napMode === m ? "#7C4DFF" : "#6B7280",
                  fontWeight: napMode === m ? 700 : 400,
                  fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                }}>{label}</button>
              ))}
            </div>

            {/* ── ONE NAP MODE ── */}
            {napMode === "one" && viewingDate === "today" && (() => {
              const hasWake = wakeTime && wakeTime !== "06:00";
              const targetH = Math.floor(onNapTargetMin / 60);
              const targetM = onNapTargetMin % 60;
              const sleepTargetStr = `${String(targetH).padStart(2,"0")}:${String(targetM).padStart(2,"0")}`;
              const enterRoomStr   = addMinutes(sleepTargetStr, -ROUTINE_MIN);
              const wakeTargetStr  = addMinutes(sleepTargetStr, ONE_NAP_DUR_TARGET);
              const isAtMax        = onNapTargetMin >= ONE_NAP_MAX_MIN;

              // Actual nap data from dayData
              const napAsleep = dayData.onNapAsleep || null;
              const napWoke   = dayData.onNapWoke || null;
              const napDur    = napAsleep && napWoke ? diffMinutes(napAsleep, napWoke) : null;

              // Night calc from actual wake or estimated
              const s1WokeStr = napWoke || (napAsleep ? addMinutes(napAsleep, ONE_NAP_DUR_TARGET) : null);
              const nightMin  = s1WokeStr
                ? Math.min(timeToMin(s1WokeStr) + ONE_NAP_NIGHT_WINDOW, ONE_NAP_NIGHT_MAX)
                : null;
              const nightStr      = nightMin ? `${String(Math.floor(nightMin/60)).padStart(2,"0")}:${String(nightMin%60).padStart(2,"0")}` : null;
              const nightEntryStr = nightStr ? addMinutes(nightStr, -ROUTINE_MIN) : null;

              return (
                <div>
                  {/* Wake time — always visible */}
                  <Card>
                    <Label>¿A qué hora despertó Camille?</Label>
                    <input
                      type="time"
                      value={wakeTime === "06:00" ? "" : wakeTime}
                      onChange={e => setWakeTime(e.target.value || "06:00")}
                      style={timeInputStyle}
                      placeholder="--:--"
                    />
                  </Card>

                  {/* Everything below only shows after wake is entered */}
                  {hasWake && (<>
                    {/* Siesta card */}
                    <Card style={{ borderLeft: "4px solid #00BCD4" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>🛌 Siesta</div>
                        {isAtMax && <span style={{ fontSize: 11, background: "#D1FAE5", color: "#065F46", padding: "3px 8px", borderRadius: 20, fontWeight: 700 }}>🎉 Meta lograda</span>}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                        <TimeBox icon="🚪" label="Entrar al cuarto" time={enterRoomStr} highlight />
                        <TimeBox icon="😴" label="Dormida objetivo" time={sleepTargetStr} />
                      </div>
                      <div style={{ background: "#F0FDF4", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                        <div>
                          <div style={{ fontSize: 11, color: "#6B7280" }}>💪 Alargar en brazos hasta</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: "#059669" }}>{formatTime(wakeTargetStr)}</div>
                        </div>
                        <div style={{ fontSize: 28 }}>💪</div>
                      </div>

                      {/* Record actual nap */}
                      <div style={{ borderTop: "1px solid #E5E7EB", paddingTop: 14 }}>
                        <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 8, fontStyle: "italic" }}>Registrar lo que pasó:</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, minWidth: 0, overflow: "hidden" }}>
                          <div style={{ minWidth: 0, overflow: "hidden" }}>
                            <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>Se durmió a las</div>
                            <input type="time" value={napAsleep || ""} onChange={e => setDayData(p => ({ ...p, onNapAsleep: e.target.value || null }))} style={timeInputStyle} />
                          </div>
                          <div style={{ minWidth: 0, overflow: "hidden" }}>
                            <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>Despertó a las</div>
                            <input type="time" value={napWoke || ""} onChange={e => setDayData(p => ({ ...p, onNapWoke: e.target.value || null }))} style={timeInputStyle} />
                          </div>
                        </div>

                        {/* Duration feedback */}
                        {napDur !== null && (() => {
                          const advance = napDur >= 75 && onNapTargetMin < ONE_NAP_MAX_MIN;
                          const nextTarget = advance ? Math.min(onNapTargetMin + 30, ONE_NAP_MAX_MIN) : onNapTargetMin;
                          return (
                            <div style={{
                              marginTop: 10, padding: "10px 12px", borderRadius: 10,
                              background: napDur >= 75 ? "#D1FAE5" : "#FEF3C7",
                              color: napDur >= 75 ? "#065F46" : "#92400E",
                              fontSize: 13, fontWeight: 600,
                            }}>
                              {advance
                                ? `✅ ${napDur} min — ¡Bien! Mañana avanzamos a las ${formatTime(`${String(Math.floor(nextTarget/60)).padStart(2,"0")}:${String(nextTarget%60).padStart(2,"0")}`)}`
                                : napDur >= 75
                                  ? `✅ ${napDur} min — ¡Meta lograda! Horario consolidado.`
                                  : `⏳ ${napDur} min — Repetimos el mismo horario mañana`
                              }
                              {advance && (
                                <button onClick={() => setOnNapTarget(nextTarget)} style={{
                                  display: "block", marginTop: 8, width: "100%",
                                  padding: "8px", background: "#059669", color: "white",
                                  border: "none", borderRadius: 8, fontSize: 13,
                                  fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                                }}>
                                  Actualizar objetivo para mañana →
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </Card>

                    {/* Night card */}
                    {nightStr && (
                      <Card style={{ borderLeft: "4px solid #7C4DFF" }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: "#111827", marginBottom: 14 }}>🌙 Noche</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                          <TimeBox icon="🚪" label="Entrar al cuarto" time={nightEntryStr} highlight />
                          <TimeBox icon="😴" label="Dormida objetivo" time={nightStr} />
                        </div>
                        {nightMin >= ONE_NAP_NIGHT_MAX && (
                          <div style={{ padding: "8px 12px", background: "#FEF3C7", borderRadius: 10, fontSize: 12, color: "#92400E", fontWeight: 600, marginBottom: 12 }}>
                            ⚠️ Siesta tardía — noche ajustada al límite de 6:30 pm.
                          </div>
                        )}
                        <div style={{ borderTop: "1px solid #E5E7EB", paddingTop: 12 }}>
                          <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>Se durmió a las</div>
                          <input type="time" value={bedAsleep || ""} onChange={e => setBedAsleep(e.target.value || null)}
                            style={{ ...timeInputStyle, pointerEvents: "auto", opacity: 1 }} />
                        </div>
                      </Card>
                    )}

                    {/* Save */}
                    <button onClick={() => { setSaveDate(TODAY); setShowSaveModal(true); }} style={{
                      width: "100%", marginTop: 8, padding: "18px",
                      background: "linear-gradient(135deg, #7C4DFF, #00BCD4)",
                      color: "white", border: "none", borderRadius: 16,
                      fontSize: 18, fontWeight: 800, cursor: "pointer",
                      fontFamily: "inherit", boxShadow: "0 4px 20px rgba(124,77,255,0.4)",
                    }}>
                      💾 Guardar día
                    </button>
                  </>)}
                </div>
              );
            })()}

            {/* ── ONE NAP YESTERDAY ── */}
            {napMode === "one" && viewingDate === "yesterday" && (
              <Card style={{ borderLeft: "4px solid #9CA3AF" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 12 }}>📋 Resumen de ayer</div>
                {yesterdayData ? (() => {
                  const yd = yesterdayData;
                  return (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                        <span style={{ color: "#6B7280" }}>☀️ Despertar</span>
                        <span style={{ fontWeight: 600 }}>{yd.wake_time ? formatTime(yd.wake_time) : "—"}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                        <span style={{ color: "#6B7280" }}>🛌 Duración siesta</span>
                        <span style={{ fontWeight: 600 }}>{yd.onNapDuration ? `${yd.onNapDuration} min` : "—"}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                        <span style={{ color: "#6B7280" }}>🌙 Noche</span>
                        <span style={{ fontWeight: 600 }}>{yd.bedAsleep ? formatTime(yd.bedAsleep) : "—"}</span>
                      </div>
                    </div>
                  );
                })() : <div style={{ color: "#9CA3AF", fontSize: 13 }}>No hay datos de ayer.</div>}
              </Card>
            )}

            {/* ── TWO NAP MODE ── */}
            {napMode === "two" && (<>
              {/* Day navigator */}
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {[["yesterday", "← Ayer"], ["today", "Hoy"]].map(([val, label]) => (
                  <button key={val} onClick={() => setViewingDate(val)} style={{
                    flex: 1, padding: "8px 0", border: "2px solid",
                    borderColor: viewingDate === val ? "#7C4DFF" : "#E5E7EB",
                    borderRadius: 10,
                    background: viewingDate === val ? "#F5F3FF" : "white",
                    color: viewingDate === val ? "#7C4DFF" : "#6B7280",
                    fontWeight: viewingDate === val ? 700 : 400,
                    fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                  }}>{label}</button>
                ))}
              </div>
              <Card style={{ borderLeft: "4px solid #9CA3AF" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 12 }}>
                  📋 Resumen de ayer
                </div>
                {yesterdayData ? (() => {
                  const yd = yesterdayData;
                  const rows = [
                    { icon: "☀️", label: "Despertar", val: yd.wake_time ? formatTime(yd.wake_time) : "—" },
                    ...(yd.naps || []).map((n, i) => ({
                      icon: "💤",
                      label: `Siesta ${i+1}`,
                      val: n.didNotHappen ? "No ocurrió" : n.asleepAt && n.wokeAt
                        ? `${formatTime(n.asleepAt)} → ${formatTime(n.wokeAt)} (${diffMinutes(n.asleepAt, n.wokeAt)} min)`
                        : "—",
                    })),
                    { icon: "🌙", label: "Noche", val: yd.bed_asleep ? formatTime(yd.bed_asleep) : "—" },
                  ];
                  return rows.map((r, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: i < rows.length-1 ? "1px solid #F3F4F6" : "none", fontSize: 13 }}>
                      <span style={{ color: "#6B7280" }}>{r.icon} {r.label}</span>
                      <span style={{ fontWeight: 600, color: "#111827" }}>{r.val}</span>
                    </div>
                  ));
                })() : (
                  <div style={{ color: "#9CA3AF", fontSize: 13 }}>No hay datos de ayer.</div>
                )}
              </Card>
            )}

            {/* Today's cards — only show when viewing today */}
            {viewingDate === "today" && (<>
              <Card>
                <Label>¿A qué hora despertó Camille?</Label>
                <input
                  type="time"
                  value={wakeTime}
                  onChange={e => setWakeTime(e.target.value)}
                  style={timeInputStyle}
                />
                <div style={{ fontSize: 12, color: "#6B7280", marginTop: 6 }}>
                  Hora de inicio del día
                </div>
              </Card>

            {/* Nap cards */}
            {schedule.map((s, i) => {
              const isNight = i === 2;
              const nap = naps[i] || {};

              return (
                <Card key={i} style={{ borderLeft: `4px solid ${s.color}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>{s.label}</div>
                      <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                        Ventana: {Math.floor(s.windowMin / 60)}h {s.windowMin % 60 > 0 ? `${s.windowMin % 60}m` : ""}
                      </div>
                    </div>
                    <div style={{
                      background: s.color + "30",
                      borderRadius: 20,
                      padding: "4px 12px",
                      fontSize: 12,
                      color: s.color,
                      fontWeight: 700,
                    }}>
                      {isNight ? "🌙 Noche" : `Siesta ${i + 1}`}
                    </div>
                  </div>

                  {/* Advisory warning for Nap 2 */}
                  {s.warn && (
                    <div style={{
                      marginTop: 10,
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "#FEF3C7",
                      color: "#92400E",
                      fontSize: 13,
                      fontWeight: 600,
                    }}>
                      ⚠️ Si hace esta siesta, la noche podría caer después de las 8 pm. Puedes hacerla igual si lo consideras necesario.
                    </div>
                  )}

                  {/* Compressed window warning */}
                  {s.compressed && (
                    <div style={{
                      marginTop: 10, padding: "10px 12px", borderRadius: 10,
                      background: "#FEE2E2", color: "#991B1B", fontSize: 13, fontWeight: 600,
                    }}>
                      ⏰ S1 terminó tarde — ventana comprimida al límite de 1:00 pm.
                    </div>
                  )}

                  {/* Calculated times */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
                    <TimeBox icon="🚪" label="Entrar al cuarto" time={s.enterRoom} highlight />
                    <TimeBox icon="😴" time={s.sleepTarget} label="Debe dormirse" />
                  </div>

                  {/* Actual recording (naps only) */}
                  {!isNight && (
                    <div style={{ marginTop: 14, borderTop: "1px solid #E5E7EB", paddingTop: 14 }}>

                      {/* Did not happen state */}
                      {s.didNotHappen ? (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            background: "#FEE2E2",
                            color: "#991B1B",
                            fontSize: 13,
                            fontWeight: 600,
                            flex: 1,
                            marginRight: 8,
                          }}>
                            ❌ Siesta no ocurrió
                          </div>
                          <button
                            onClick={() => clearNap(i)}
                            style={{
                              padding: "8px 12px",
                              border: "1.5px solid #E5E7EB",
                              borderRadius: 10,
                              background: "white",
                              fontSize: 12,
                              color: "#6B7280",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              whiteSpace: "nowrap",
                            }}>
                            Deshacer
                          </button>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 8, fontStyle: "italic" }}>
                            Registrar lo que pasó:
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, minWidth: 0, overflow: "hidden" }}>
                            <div style={{ minWidth: 0, overflow: "hidden" }}>
                              <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>Se durmió a las</div>
                              <input
                                type="time"
                                value={nap.asleepAt || ""}
                                onChange={e => recordNapAsleep(i, e.target.value)}
                                style={timeInputStyle}
                              />
                            </div>
                            <div style={{ minWidth: 0, overflow: "hidden" }}>
                              <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>Despertó a las</div>
                              <input
                                type="time"
                                value={nap.wokeAt || ""}
                                onChange={e => recordNapWoke(i, e.target.value)}
                                style={timeInputStyle}
                              />
                            </div>
                          </div>

                          {/* Tiempo en dormirla — automático */}
                          {nap.asleepAt && s.enterRoom && (
                            <div style={{
                              marginTop: 8,
                              padding: "8px 12px",
                              borderRadius: 10,
                              background: "#F0F9FF",
                              border: "1px solid #BAE6FD",
                              fontSize: 13,
                            }}>
                              <span style={{ color: "#6B7280" }}>⏱ Tiempo en dormirla: </span>
                              <span style={{ fontWeight: 700, color: "#0369A1" }}>
                                {Math.max(0, diffMinutes(s.enterRoom, nap.asleepAt))} min
                              </span>
                            </div>
                          )}

                          {/* Clear fields button */}
                          {(nap.asleepAt || nap.wokeAt) && (
                            <button
                              onClick={() => clearNap(i)}
                              style={{
                                marginTop: 8,
                                padding: "6px 12px",
                                border: "1.5px solid #E5E7EB",
                                borderRadius: 8,
                                background: "white",
                                fontSize: 12,
                                color: "#9CA3AF",
                                cursor: "pointer",
                                fontFamily: "inherit",
                              }}>
                              🗑 Limpiar campos
                            </button>
                          )}

                          {nap.long !== null && (
                            <div style={{
                              marginTop: 10,
                              padding: "8px 12px",
                              borderRadius: 10,
                              background: nap.long ? "#D1FAE5" : "#FEF3C7",
                              color: nap.long ? "#065F46" : "#92400E",
                              fontSize: 13,
                              fontWeight: 600,
                            }}>
                              {nap.long
                                ? `✅ Siesta larga (${diffMinutes(nap.asleepAt, nap.wokeAt)} min) · Ventanas normales`
                                : `⚠️ Siesta corta (${diffMinutes(nap.asleepAt, nap.wokeAt)} min) · Menos de 1h10`}
                            </div>
                          )}

                          {/* Did not happen button */}
                          <button
                            onClick={() => markDidNotHappen(i)}
                            style={{
                              marginTop: 10,
                              width: "100%",
                              padding: "8px",
                              border: "1.5px dashed #FCA5A5",
                              borderRadius: 10,
                              background: "white",
                              fontSize: 13,
                              color: "#EF4444",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              fontWeight: 600,
                            }}>
                            ❌ Siesta no ocurrió
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Late bedtime warning */}
                  {isNight && s.bedLate && (
                    <div style={{
                      marginTop: 10, padding: "10px 12px", borderRadius: 10,
                      background: "#FEE2E2", color: "#991B1B", fontSize: 13, fontWeight: 600,
                    }}>
                      ⏰ Noche tardía — ajustada al límite de 7:30 pm.
                    </div>
                  )}
                  {isNight && (
                    <div style={{ marginTop: 14, borderTop: "1px solid #E5E7EB", paddingTop: 14 }}>
                      <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>Se durmió a las</div>
                      <input
                        type="time"
                        value={bedAsleep || ""}
                        onChange={e => setBedAsleep(e.target.value || null)}
                        style={{ ...timeInputStyle, pointerEvents: "auto", opacity: 1 }}
                      />
                      {bedAsleep && (
                        <button onClick={() => setBedAsleep(null)} style={{
                          marginTop: 8, padding: "6px 12px",
                          border: "1.5px solid #E5E7EB", borderRadius: 8,
                          background: "white", fontSize: 12, color: "#9CA3AF",
                          cursor: "pointer", fontFamily: "inherit",
                        }}>🗑 Limpiar</button>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
            </>)}

            {viewingDate === "today" && (
            <div style={{ fontSize: 12, color: "#4B5563", textAlign: "center", marginTop: 8, fontStyle: "italic" }}>
              Rutina de entrada: 30 min antes de la hora objetivo
            </div>)}
            {viewingDate === "today" && (
            <button
              onClick={async () => {
                if (window.confirm("¿Resetear el día? Se borrará todo el progreso de hoy.")) {
                  try { localStorage.removeItem(`camille-${TODAY}`); } catch {}
                  setDayData(DEFAULT_DAY);
                }
              }}
              style={{
                width: "100%",
                marginTop: 12,
                padding: "10px",
                background: "none",
                border: "1.5px solid #E5E7EB",
                borderRadius: 12,
                fontSize: 13,
                color: "#9CA3AF",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              🔄 Resetear día
            </button>
            )}

            {/* BIG SAVE BUTTON */}
            {viewingDate === "today" && (
            <button
              onClick={() => { setSaveDate(TODAY); setShowSaveModal(true); }}
              style={{
                width: "100%", marginTop: 16, padding: "18px",
                background: "linear-gradient(135deg, #7C4DFF, #00BCD4)",
                color: "white", border: "none", borderRadius: 16,
                fontSize: 18, fontWeight: 800, cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "0 4px 20px rgba(124,77,255,0.4)",
              }}
            >
              💾 Guardar día
            </button>
            )}
            </>)}
          </div>
        )}

        {/* ── SAVE MODAL ── */}
        {showSaveModal && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "flex-end", zIndex: 100,
          }} onClick={() => setShowSaveModal(false)}>
            <div onClick={e => e.stopPropagation()} style={{
              background: "white", borderRadius: "20px 20px 0 0",
              padding: 24, width: "100%", boxSizing: "border-box",
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#111827", marginBottom: 6 }}>
                💾 ¿A qué fecha corresponde?
              </div>
              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 16 }}>
                {view === "lechucera"
                  ? "Confirma la noche antes de guardar los despertares."
                  : "Confirma la fecha de este registro antes de guardar."}
              </div>
              <input
                type="date"
                value={saveDate}
                onChange={e => setSaveDate(e.target.value)}
                style={{
                  width: "100%", padding: "12px", border: "2px solid #E5E7EB",
                  borderRadius: 12, fontSize: 16, fontFamily: "inherit",
                  color: "#111827", fontWeight: 700, background: "#F9FAFB",
                  boxSizing: "border-box", marginBottom: 16,
                }}
              />
              <button
                onClick={() => {
                  if (view === "lechucera") {
                    saveDay(`night-${saveDate}`, nightData);
                  } else {
                    saveDay(saveDate, dayData);
                  }
                  setShowSaveModal(false);
                  alert(`✅ Guardado para el ${new Date(saveDate + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}`);
                }}
                style={{
                  width: "100%", padding: "16px",
                  background: "linear-gradient(135deg, #7C4DFF, #00BCD4)",
                  color: "white", border: "none", borderRadius: 14,
                  fontSize: 16, fontWeight: 800, cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                ✅ Confirmar y guardar
              </button>
              <button
                onClick={() => setShowSaveModal(false)}
                style={{
                  width: "100%", padding: "12px", marginTop: 8,
                  background: "none", border: "none", color: "#9CA3AF",
                  fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                }}
              >Cancelar</button>
            </div>
          </div>
        )}

        {/* ── LECHUCERA VIEW ── */}
        {view === "lechucera" && (
          <div>
            <Card>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 12 }}>
                🦉 Despertares nocturnos
              </div>

              {/* Night date selector — last 3 nights */}
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {[0, 1, 2].map(offset => {
                  const d = getLimaDateOffset(-offset);
                  // For display: offset 0 = "Anoche", 1 = "Hace 2 noches", etc
                  // But use actual night date logic
                  const nightD = (() => {
                    const lima = new Date(Date.now() - 5 * 60 * 60 * 1000);
                    const hour = lima.getHours();
                    const base = new Date(lima);
                    if (hour < 6) base.setDate(base.getDate() - 1);
                    base.setDate(base.getDate() - offset);
                    return base.toISOString().slice(0, 10);
                  })();
                  const labels = ["Esta noche", "Anoche", "Hace 2 noches"];
                  const isSelected = selectedNightDate === nightD;
                  return (
                    <button key={offset} onClick={() => setSelectedNightDate(nightD)} style={{
                      flex: 1,
                      padding: "8px 4px",
                      border: "2px solid",
                      borderColor: isSelected ? "#7C4DFF" : "#E5E7EB",
                      borderRadius: 10,
                      background: isSelected ? "#F5F3FF" : "white",
                      color: isSelected ? "#7C4DFF" : "#6B7280",
                      fontWeight: isSelected ? 700 : 400,
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}>{labels[offset]}</button>
                  );
                })}
              </div>

              {/* Wakings list */}
              {(nightData.wakings || []).map((w, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr 32px",
                  gap: 8, marginBottom: 10, alignItems: "end",
                }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>Se despertó</div>
                    <input type="time" value={w.time || ""} onChange={e => {
                      const w2 = [...(nightData.wakings || [])];
                      w2[i] = { ...w2[i], time: e.target.value };
                      setNight({ wakings: w2 });
                    }} style={timeInputStyle} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>Min hasta dormirse</div>
                    <input type="number" min="0" max="120" placeholder="ej. 20"
                      value={w.fellBackAsleepMins || ""}
                      onChange={e => {
                        const w2 = [...(nightData.wakings || [])];
                        w2[i] = { ...w2[i], fellBackAsleepMins: e.target.value ? parseInt(e.target.value) : null };
                        setNight({ wakings: w2 });
                      }}
                      style={{ ...timeInputStyle, fontSize: 16 }} />
                  </div>
                  <button onClick={() => {
                    const w2 = (nightData.wakings || []).filter((_, j) => j !== i);
                    setNight({ wakings: w2 });
                  }} style={{
                    width: 32, height: 42, border: "1.5px solid #FCA5A5",
                    borderRadius: 8, background: "white", color: "#EF4444",
                    fontSize: 16, cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                  }}>×</button>
                </div>
              ))}

              {/* Add waking button */}
              <button onClick={() => {
                const w2 = [...(nightData.wakings || []), { time: "", fellBackAsleepMins: null }];
                setNight({ wakings: w2 });
              }} style={{
                width: "100%", padding: "12px", marginTop: 4,
                border: "2px dashed #C4B5FD", borderRadius: 12,
                background: "white", color: "#7C4DFF", fontSize: 14,
                fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}>
                + Agregar despertar
              </button>
            </Card>

            {/* Summary */}
            {(nightData.wakings || []).length > 0 && (
              <Card>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ background: "#F5F3FF", borderRadius: 12, padding: "12px", textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "#7C4DFF" }}>
                      {(nightData.wakings || []).length}
                    </div>
                    <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>despertares</div>
                  </div>
                  <div style={{ background: "#F0FDF4", borderRadius: 12, padding: "12px", textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "#059669" }}>
                      {(() => {
                        const mins = (nightData.wakings || []).filter(w => w.fellBackAsleepMins).map(w => w.fellBackAsleepMins);
                        if (!mins.length) return "—";
                        return `${Math.round(mins.reduce((a,b) => a+b, 0) / mins.length)} min`;
                      })()}
                    </div>
                    <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>promedio conciliación</div>
                  </div>
                </div>
              </Card>
            )}

            {/* SAVE BUTTON for Mili */}
            <button
              onClick={() => { setSaveDate(selectedNightDate); setShowSaveModal(true); }}
              style={{
                width: "100%", marginTop: 8, padding: "18px",
                background: "linear-gradient(135deg, #7C4DFF, #00BCD4)",
                color: "white", border: "none", borderRadius: 16,
                fontSize: 18, fontWeight: 800, cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "0 4px 20px rgba(124,77,255,0.4)",
              }}
            >
              💾 Guardar noche
            </button>
          </div>
        )}

        {/* ── MAMÁ / COACH VIEW ── */}
        {view === "coach" && (() => {
          // Load 30 days of data
          const history = Array.from({ length: 30 }, (_, i) => {
            const dateStr = getLimaDateOffset(-(29 - i));
            const d = loadDay(dateStr);
            const n = loadDay(`night-${dateStr}`);
            return { date: dateStr, day: d, night: n };
          }).filter(r => r.day?.wakeTime);

          // ── MILI analytics ────────────────────────────────────
          const nightRows = history.map(r => {
            const wakings = r.night?.wakings || [];
            const concMins = wakings.filter(w => w.fellBackAsleepMins).map(w => w.fellBackAsleepMins);
            const avgConc = concMins.length ? Math.round(concMins.reduce((a,b)=>a+b,0)/concMins.length) : null;
            // Hours between wakings
            // Fix: hours before 6am belong to the next calendar day, add 24h
            const times = wakings.filter(w => w.time).map(w => {
              const mins = timeToMin(w.time);
              return mins < 360 ? mins + 1440 : mins; // before 6am → add 24h
            }).sort((a,b) => a-b);
            const gaps = times.slice(1).map((t,i) => t - times[i]);
            const avgGap = gaps.length ? Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length) : null;
            return { date: r.date, count: wakings.length, avgConc, avgGap, wakings, times };
          });

          // Hour frequency map for wakings
          const hourFreq = {};
          nightRows.forEach(r => {
            r.times.forEach(t => {
              const h = Math.floor(t / 60);
              hourFreq[h] = (hourFreq[h] || 0) + 1;
            });
          });
          const topHours = Object.entries(hourFreq)
            .sort((a,b) => b[1]-a[1])
            .slice(0, 3)
            .map(([h, count]) => ({ hour: parseInt(h), count }));

          // Best/worst conciliation across all wakings
          const allWakings = nightRows.flatMap(r => r.wakings.filter(w => w.fellBackAsleepMins));
          const bestConc = allWakings.length ? Math.min(...allWakings.map(w => w.fellBackAsleepMins)) : null;
          const worstConc = allWakings.length ? Math.max(...allWakings.map(w => w.fellBackAsleepMins)) : null;

          // Last 7 nights for trend
          const last7nights = nightRows.slice(-7);

          // ── LUCY analytics ────────────────────────────────────
          const dayRows = history.map(r => {
            const naps = r.day?.naps || [];
            let prevWake = r.day?.wakeTime || "06:00";
            const napStats = naps.map((nap, ni) => {
              const win = WINDOWS[ni];
              const totalNapMins = nap.asleepAt && nap.wokeAt && !nap.didNotHappen
                ? diffMinutes(nap.asleepAt, nap.wokeAt) : 0;
              const asleepHour = nap.asleepAt ? Math.floor(timeToMin(nap.asleepAt)/60) + (timeToMin(nap.asleepAt)%60)/60 : null;
              prevWake = nap.wokeAt || prevWake;
              return { asleepAt: nap.asleepAt, dur: totalNapMins, didNotHappen: nap.didNotHappen, asleepHour };
            });
            const totalSleep = napStats.reduce((a,n) => a + n.dur, 0);
            const napCount = napStats.filter(n => !n.didNotHappen && n.dur > 0).length;
            return { date: r.date, napStats, totalSleep, napCount };
          });

          // Sweet spot: most common asleep hour per nap slot (30-min buckets)
          function sweetSpot(napIdx) {
            const buckets = {};
            dayRows.forEach(r => {
              const nap = r.napStats[napIdx];
              if (!nap?.asleepAt || nap.didNotHappen) return;
              const [h, m] = nap.asleepAt.split(":").map(Number);
              const bucket = `${String(h).padStart(2,"0")}:${m < 30 ? "00" : "30"}`;
              buckets[bucket] = (buckets[bucket] || 0) + 1;
            });
            const sorted = Object.entries(buckets).sort((a,b) => b[1]-a[1]);
            return sorted.slice(0, 2).map(([time, count]) => ({ time, count }));
          }
          const sweet1 = sweetSpot(0);
          const sweet2 = sweetSpot(1);

          const avgTotalSleep = dayRows.length
            ? Math.round(dayRows.reduce((a,r) => a+r.totalSleep, 0) / dayRows.length)
            : 0;
          const days1nap = dayRows.filter(r => r.napCount === 1).length;
          const days2nap = dayRows.filter(r => r.napCount === 2).length;

          // Mini bar chart helper
          function MiniBar({ values, color, maxVal }) {
            const max = maxVal || Math.max(...values, 1);
            return (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 56 }}>
                {values.map((v, i) => (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: v ? color : "#9CA3AF", marginBottom: 2 }}>
                      {v || ""}
                    </div>
                    <div style={{
                      width: "100%",
                      background: v ? color : "#F3F4F6",
                      height: `${Math.round((v / max) * 70)}%`,
                      minHeight: v ? 4 : 2,
                      borderRadius: 3,
                    }} />
                  </div>
                ))}
              </div>
            );
          }

          return (
            <div>
              {/* ── PANEL MILI ─────────────────────────────── */}
              <div style={{ fontSize: 13, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                🌙 Panel Mili — Noches
              </div>

              {/* Trend: wakings count */}
              <Card>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
                  Despertares por noche
                  {last7nights.length > 1 && (() => {
                    const first = last7nights[0].count;
                    const last = last7nights[last7nights.length-1].count;
                    const diff = last - first;
                    return <span style={{ fontSize: 12, fontWeight: 600, color: diff < 0 ? "#059669" : diff > 0 ? "#DC2626" : "#6B7280", marginLeft: 8 }}>
                      {diff < 0 ? `↓ ${Math.abs(diff)} menos` : diff > 0 ? `↑ ${diff} más` : "→ igual"} vs hace 7 días
                    </span>;
                  })()}
                </div>
                <MiniBar values={last7nights.map(r => r.count)} color="#7C4DFF" />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9CA3AF", marginTop: 4 }}>
                  {last7nights.map((r,i) => <span key={i}>{new Date(r.date+"T12:00:00").toLocaleDateString("es-ES",{weekday:"short"})}</span>)}
                </div>
              </Card>

              {/* Trend: conciliation */}
              <Card>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
                  Conciliación promedio nocturna (min)
                </div>
                <MiniBar values={last7nights.map(r => r.avgConc || 0)} color="#00BCD4" />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9CA3AF", marginTop: 4 }}>
                  {last7nights.map((r,i) => <span key={i}>{r.avgConc !== null ? `${r.avgConc}m` : "—"}</span>)}
                </div>
              </Card>

              {/* Hours frequency + gap */}
              <Card>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 12 }}>
                  Patrones de despertar
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ background: "#F5F3FF", borderRadius: 12, padding: 12 }}>
                    <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 6 }}>Horas más frecuentes</div>
                    {topHours.length ? topHours.map((h,i) => (
                      <div key={i} style={{ fontSize: 13, fontWeight: 700, color: "#7C4DFF" }}>
                        {formatTime(`${String(h.hour).padStart(2,"0")}:00`)} · {h.count}x
                      </div>
                    )) : <div style={{ fontSize: 12, color: "#9CA3AF" }}>Sin datos</div>}
                  </div>
                  <div style={{ background: "#F0FDF4", borderRadius: 12, padding: 12 }}>
                    <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 6 }}>Tiempo entre despertares</div>
                    {(() => {
                      const gaps = nightRows.filter(r => r.avgGap).map(r => r.avgGap);
                      const avg = gaps.length ? Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length) : null;
                      return avg ? (
                        <div style={{ fontSize: 20, fontWeight: 800, color: "#059669" }}>
                          {Math.floor(avg/60)}h {avg%60}m
                        </div>
                      ) : <div style={{ fontSize: 12, color: "#9CA3AF" }}>Sin datos</div>;
                    })()}
                    <div style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}>promedio</div>
                  </div>
                </div>

                {/* Best/worst conciliation */}
                {bestConc !== null && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                    <div style={{ background: "#ECFDF5", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: "#059669" }}>{bestConc} min</div>
                      <div style={{ fontSize: 11, color: "#6B7280" }}>✅ Más fácil</div>
                    </div>
                    <div style={{ background: "#FEF2F2", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: "#DC2626" }}>{worstConc} min</div>
                      <div style={{ fontSize: 11, color: "#6B7280" }}>😓 Más difícil</div>
                    </div>
                  </div>
                )}
              </Card>

              {/* ── PANEL LUCY ─────────────────────────────── */}
              <div style={{ fontSize: 13, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, marginTop: 8 }}>
                🧸 Panel Lucy — Siestas
              </div>

              {/* Sweet spot */}
              <Card>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 12 }}>
                  Sweet spot — hora en que más se duerme
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[["Siesta 1", sweet1, "#00BCD4"], ["Siesta 2", sweet2, "#43A047"]].map(([label, spots, color]) => (
                    <div key={label} style={{ background: "#F9FAFB", borderRadius: 12, padding: 12 }}>
                      <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 6 }}>{label}</div>
                      {spots.length ? spots.map((s,i) => (
                        <div key={i} style={{ fontSize: i===0?16:13, fontWeight: i===0?800:600, color: i===0?color:"#6B7280" }}>
                          {formatTime(s.time + ":00")} · {s.count}x
                        </div>
                      )) : <div style={{ fontSize: 12, color: "#9CA3AF" }}>Sin datos</div>}
                    </div>
                  ))}
                </div>
              </Card>

              {/* Total sleep + nap days */}
              <Card>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 12 }}>
                  Resumen de siestas
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div style={{ background: "#F0F9FF", borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#0369A1" }}>
                      {Math.floor(avgTotalSleep/60)}h{String(avgTotalSleep%60).padStart(2,"0")}
                    </div>
                    <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>Sueño diurno prom.</div>
                  </div>
                  <div style={{ background: "#F0FDF4", borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#059669" }}>{days2nap}</div>
                    <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>Días con 2 siestas</div>
                  </div>
                  <div style={{ background: "#FEF3C7", borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#D97706" }}>{days1nap}</div>
                    <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>Días con 1 siesta</div>
                  </div>
                </div>
              </Card>

              {/* CSV download */}
              <button
                onClick={() => {
                  const rows = [["Fecha","Despertar","S1 inicio","S1 fin","S1 dur (min)","S1 conc (min)","S2 inicio","S2 fin","S2 dur (min)","S2 conc (min)","Hora dormir","Despertares","Conc prom noche (min)","D1 hora","D1 conc (min)","D2 hora","D2 conc (min)","D3 hora","D3 conc (min)","D4 hora","D4 conc (min)","D5 hora","D5 conc (min)","D6 hora","D6 conc (min)","D7 hora","D7 conc (min)","D8 hora","D8 conc (min)","D9 hora","D9 conc (min)","D10 hora","D10 conc (min)"]];
                  for (let i = 29; i >= 0; i--) {
                    const dateStr = getLimaDateOffset(-i);
                    const d = loadDay(dateStr);
                    const n = loadDay(`night-${dateStr}`);
                    if (!d?.wakeTime) continue;
                    const napsD = d.naps || [];
                    let prevWake = d.wakeTime;
                    const napCols = [];
                    napsD.forEach((nap, ni) => {
                      const win = WINDOWS[ni];
                      if (!win) return;
                      const sleepTarget = addMinutes(prevWake, win.windowMin);
                      const enterRoom = addMinutes(sleepTarget, -ROUTINE_MIN);
                      const dur = nap.asleepAt && nap.wokeAt ? diffMinutes(nap.asleepAt, nap.wokeAt) : "";
                      const conc = nap.asleepAt ? Math.max(0, diffMinutes(enterRoom, nap.asleepAt)) : "";
                      napCols.push(nap.asleepAt||"", nap.wokeAt||"", dur, nap.didNotHappen?"no ocurrió":conc);
                      prevWake = nap.wokeAt || addMinutes(nap.asleepAt||sleepTarget, 75);
                    });
                    while (napCols.length < 8) napCols.push("");
                    const wakings = n?.wakings || [];
                    const nightConc = wakings.filter(w=>w.fellBackAsleepMins).map(w=>w.fellBackAsleepMins);
                    const avgNightConc = nightConc.length ? Math.round(nightConc.reduce((a,b)=>a+b,0)/nightConc.length) : "";
                    // Individual wakings — up to 10
                    const wakingCols = [];
                    for (let wi = 0; wi < 10; wi++) {
                      const w = wakings[wi];
                      wakingCols.push(w?.time || "", w?.fellBackAsleepMins ?? "");
                    }
                    rows.push([dateStr, d.wakeTime, ...napCols, d.bedAsleep||"", wakings.length||"", avgNightConc, ...wakingCols]);
                  }
                  const csv = rows.map(r=>r.join(",")).join("\n");
                  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `camille-sueño-${TODAY}.csv`; a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{
                  width: "100%", padding: "14px",
                  background: "white", color: "#7C4DFF",
                  border: "2px solid #7C4DFF", borderRadius: 16,
                  fontSize: 15, fontWeight: 700, cursor: "pointer",
                  fontFamily: "inherit", marginTop: 8, marginBottom: 8,
                }}
              >
                📥 Descargar historial completo (CSV)
              </button>

              {/* CSV import */}
              <label style={{
                display: "block", width: "100%", padding: "14px",
                background: "white", color: "#059669",
                border: "2px solid #059669", borderRadius: 16,
                fontSize: 15, fontWeight: 700, cursor: "pointer",
                fontFamily: "inherit", marginBottom: 16,
                textAlign: "center", boxSizing: "border-box",
              }}>
                📂 Importar CSV
                <input type="file" accept=".csv" style={{ display: "none" }} onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = ev => {
                    try {
                      const lines = ev.target.result.split("\n").filter(l => l.trim());
                      // Skip header row
                      const dataRows = lines.slice(1);
                      let imported = 0;
                      let skipped = 0;
                      dataRows.forEach(line => {
                        const cols = line.split(",");
                        // Columns: Fecha(0), Despertar(1), S1inicio(2), S1fin(3), S1dur(4), S1conc(5), S2inicio(6), S2fin(7), S2dur(8), S2conc(9), HoraDormir(10), Despertares(11), ConcNoche(12)
                        const date = cols[0]?.trim();
                        const wakeTime = cols[1]?.trim();
                        if (!date || !wakeTime || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; return; }
                        // Build naps
                        const naps = [0, 1].map(i => {
                          const offset = 2 + i * 4;
                          const asleepAt = cols[offset]?.trim() || null;
                          const wokeAt = cols[offset+1]?.trim() || null;
                          const dur = parseInt(cols[offset+2]?.trim());
                          const concOrStatus = cols[offset+3]?.trim();
                          const didNotHappen = concOrStatus === "no ocurrió";
                          const long = dur >= 70;
                          return { asleepAt: asleepAt||null, wokeAt: wokeAt||null, long: isNaN(dur) ? null : long, didNotHappen, timeToFallAsleep: null };
                        });
                        const bedAsleep = cols[10]?.trim() || null;
                        // Read individual wakings from columns 13+ (D1 hora, D1 conc, D2 hora, D2 conc...)
                        const wakings = [];
                        for (let wi = 0; wi < 10; wi++) {
                          const timeCol = cols[13 + wi * 2]?.trim();
                          const concCol = cols[14 + wi * 2]?.trim();
                          if (timeCol) {
                            wakings.push({
                              time: timeCol,
                              fellBackAsleepMins: concCol ? parseInt(concCol) : null,
                            });
                          }
                        }
                        saveDay(date, { wakeTime, naps, bedAsleep });
                        if (wakings.length > 0) saveDay(`night-${date}`, { wakings });
                        imported++;
                      });
                      e.target.value = "";
                      alert(`✅ Importado: ${imported} días\n${skipped > 0 ? `⚠️ Omitidos: ${skipped} filas inválidas` : ""}`);
                      window.location.reload();
                    } catch(err) {
                      alert("❌ Error al leer el archivo. Asegúrate de que sea el CSV exportado por esta app.");
                    }
                  };
                  reader.readAsText(file);
                }} />
              </label>
            </div>
          );
        })()}
      </div>
    </div>
  );
}



// ── UI helpers ─────────────────────────────────────────────────
function Card({ children, style = {}, ref }) {
  return (
    <div ref={ref} style={{
      background: "white",
      borderRadius: 16,
      padding: "16px",
      marginBottom: 12,
      boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
      border: "1px solid #E5E7EB",
      boxSizing: "border-box",
      width: "100%",
      overflow: "hidden",
      ...style,
    }}>
      {children}
    </div>
  );
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 10 }}>
      {children}
    </div>
  );
}

function TimeBox({ icon, label, time, highlight }) {
  return (
    <div style={{
      background: highlight ? "#F3F0FF" : "#F9FAFB",
      border: highlight ? "2px solid #7C4DFF" : "2px solid #E5E7EB",
      borderRadius: 12,
      padding: "10px 12px",
    }}>
      <div style={{ fontSize: 18 }}>{icon}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: highlight ? "#7C4DFF" : "#111827", marginTop: 2 }}>
        {formatTime(time)}
      </div>
      <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{label}</div>
    </div>
  );
}

const timeInputStyle = {
  width: "100%",
  maxWidth: "100%",
  padding: "10px 6px",
  border: "2px solid #E5E7EB",
  borderRadius: 12,
  fontSize: 15,
  fontFamily: "inherit",
  color: "#111827",
  fontWeight: 700,
  background: "#F9FAFB",
  boxSizing: "border-box",
  outline: "none",
  minWidth: 0,
  display: "block",
  WebkitAppearance: "none",
  appearance: "none",
  overflow: "hidden",
};
