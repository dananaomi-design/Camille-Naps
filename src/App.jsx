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
  { label: "Siesta 2", windowMin: 210, color: "#43A047" },
  { label: "Noche",    windowMin: 180, color: "#7C4DFF" },
];
const ROUTINE_MIN = 30;
const TODAY = getLimaDate();
const EMPTY_NAPS = [
  { asleepAt: null, wokeAt: null, long: null, didNotHappen: false, timeToFallAsleep: null },
  { asleepAt: null, wokeAt: null, long: null, didNotHappen: false, timeToFallAsleep: null },
];
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
function timeToFrac(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return (h * 60 + m) / (24 * 60);
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
  const chartRef = useRef(null);

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
    return { log_date: dateStr, wake_time: d?.wakeTime, naps: d?.naps, bed_asleep: d?.bedAsleep };
  });

  // ── Helpers de tiempo ────────────────────────────────────────
  function timeToMin(t) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  // Hora mínima noche con Siesta 2: 6:30pm
  // Hora mínima noche sin Siesta 2: 5:30pm
  const BEDTIME_CUTOFF_MIN   = 20 * 60;       // 8:00 pm — si se pasa, cancelar siesta 2
  const EARLIEST_BED_NORMAL  = 18 * 60 + 30;  // 6:30 pm — mínimo con siestas normales
  const EARLIEST_BED_SKIP    = 17 * 60 + 30;  // 5:30 pm — mínimo si se cancela siesta 2

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

    // ── Siesta 2: calcular si conviene ───────────────────────
    const win1 = WINDOWS[1];
    let windowMin1 = win1.windowMin;
    // Si siesta 1 no ocurrió, ventana se recalcula desde el despertar original
    // sumando horas que lleva despierta (ventana 1 + ventana 2)
    if (nap1DNH) {
      windowMin1 = win0.windowMin + win1.windowMin;
    } else if (naps[0].long === false) {
      windowMin1 = Math.max(windowMin1 - 20, 150);
    }

    const sleepTarget1    = addMinutes(nap1DNH ? wakeTime : currentWake, windowMin1);
    const enterRoom1      = addMinutes(sleepTarget1, -ROUTINE_MIN);
    const estWake1        = addMinutes(sleepTarget1, 75);
    const win2            = WINDOWS[2];
    const projectedBedMin = timeToMin(addMinutes(estWake1, win2.windowMin));
    const skipNap2        = !nap1DNH && projectedBedMin > BEDTIME_CUTOFF_MIN;

    const actual1 = naps[1]?.asleepAt;
    const woke1   = naps[1]?.wokeAt;
    const nap2DNH = naps[1]?.didNotHappen;
    schedule.push({
      label: win1.label, color: win1.color,
      windowMin: windowMin1,
      enterRoom: enterRoom1, sleepTarget: sleepTarget1,
      actual: actual1, woke: woke1, long: naps[1]?.long,
      currentWake: nap1DNH ? wakeTime : currentWake,
      skip: skipNap2, didNotHappen: nap2DNH,
      projectedBed: addMinutes(estWake1, win2.windowMin),
    });

    if (!skipNap2 && !nap2DNH) {
      if (woke1)        currentWake = woke1;
      else if (actual1) currentWake = addMinutes(actual1, 60);
      else              currentWake = nap1DNH ? addMinutes(wakeTime, windowMin1 + 75) : addMinutes(sleepTarget1, 75);
    }

    // ── Noche ─────────────────────────────────────────────────
    let sleepTarget2 = addMinutes(currentWake, win2.windowMin);

    if (skipNap2 || nap2DNH) {
      // Sin Siesta 2: mínimo 5:30pm, máximo ventana de 4h
      const fromWake = addMinutes(currentWake, 4 * 60);
      const finalMin = Math.max(timeToMin(fromWake), EARLIEST_BED_SKIP);
      const hh = Math.floor(finalMin / 60);
      const mm = finalMin % 60;
      sleepTarget2 = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
    } else {
      // Con siestas normales: nunca antes de las 6:30pm
      const normalMin = Math.max(timeToMin(sleepTarget2), EARLIEST_BED_NORMAL);
      const hh = Math.floor(normalMin / 60);
      const mm = normalMin % 60;
      sleepTarget2 = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
    }
    const enterRoom2   = addMinutes(sleepTarget2, -ROUTINE_MIN);

    schedule.push({
      label: win2.label, color: win2.color,
      windowMin: win2.windowMin,
      enterRoom: enterRoom2, sleepTarget: sleepTarget2,
      actual: bedAsleep, woke: null, long: null,
      currentWake, skip: false,
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
      n[i] = { ...n[i], wokeAt: time, long: dur >= 90 };
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

  // ── Coach Chart Data ─────────────────────────────────────────
  function buildTimeline() {
    const events = [];
    const dayStart = "06:00";

    events.push({ type: "wake", time: wakeTime, label: "Despertar" });

    schedule.forEach((s, i) => {
      if (i < 2) {
        if (s.didNotHappen) return; // no mostrar en el gráfico
        const sleepStart = s.actual || s.sleepTarget;
        const sleepEnd   = s.woke || addMinutes(sleepStart, s.long === false ? 40 : 75);
        events.push({
          type: "nap",
          start: sleepStart,
          end: sleepEnd,
          label: s.label,
          color: s.color,
          long: s.long,
        });
        events.push({ type: "wake", time: sleepEnd, label: `Despertar ${s.label}` });
      } else {
        const bedStart = s.actual || s.sleepTarget;
        events.push({ type: "bed", start: bedStart, label: "Noche", color: s.color });
      }
    });

    return events;
  }

  const timeline = buildTimeline();

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
            {[["nanny", "🧸 Nana"], ["coach", "📊 Sleep Coach"]].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} style={{
                flex: 1,
                padding: "10px 0",
                border: "none",
                background: "none",
                borderBottom: view === v ? "3px solid #7C4DFF" : "3px solid transparent",
                color: view === v ? "#7C4DFF" : "#9CA3AF",
                fontWeight: view === v ? 700 : 400,
                fontSize: 14,
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
            {/* Day navigator */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {[["yesterday", "← Ayer"], ["today", "Hoy"]].map(([val, label]) => (
                <button key={val} onClick={() => setViewingDate(val)} style={{
                  flex: 1,
                  padding: "8px 0",
                  border: "2px solid",
                  borderColor: viewingDate === val ? "#7C4DFF" : "#E5E7EB",
                  borderRadius: 10,
                  background: viewingDate === val ? "#F5F3FF" : "white",
                  color: viewingDate === val ? "#7C4DFF" : "#6B7280",
                  fontWeight: viewingDate === val ? 700 : 400,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}>{label}</button>
              ))}
            </div>
            {/* Yesterday read-only view */}
            {viewingDate === "yesterday" && (
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
                <Card key={i} style={{ borderLeft: `4px solid ${s.skip ? "#D1D5DB" : s.color}`, opacity: s.skip ? 0.6 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: s.skip ? "#9CA3AF" : "#111827" }}>{s.label}</div>
                      <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                        Ventana: {Math.floor(s.windowMin / 60)}h {s.windowMin % 60 > 0 ? `${s.windowMin % 60}m` : ""}
                      </div>
                    </div>
                    <div style={{
                      background: s.skip ? "#F3F4F6" : s.color + "30",
                      borderRadius: 20,
                      padding: "4px 12px",
                      fontSize: 12,
                      color: s.skip ? "#9CA3AF" : s.color,
                      fontWeight: 700,
                    }}>
                      {isNight ? "🌙 Noche" : s.skip ? "⏭ Saltar" : `Siesta ${i + 1}`}
                    </div>
                  </div>

                  {/* Skip warning for Nap 2 */}
                  {s.skip && (
                    <div style={{
                      marginTop: 10,
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "#FEF3C7",
                      color: "#92400E",
                      fontSize: 13,
                      fontWeight: 600,
                    }}>
                      ⚠️ Si hace esta siesta la noche caería después de las 7:30 pm. <strong>No hacer Siesta 2</strong> — la hora de dormir se calcula desde el último despertar.
                    </div>
                  )}

                  {/* Calculated times — hide for skipped nap */}
                  {!s.skip && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
                      <TimeBox icon="🚪" label="Entrar al cuarto" time={s.enterRoom} highlight />
                      <TimeBox icon="😴" time={s.sleepTarget} label="Debe dormirse" />
                    </div>
                  )}

                  {/* Actual recording (naps only, not skipped) */}
                  {!isNight && !s.skip && (
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
                                : `⚠️ Siesta corta (${diffMinutes(nap.asleepAt, nap.wokeAt)} min) · Menos de 1h30`}
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

                  {/* Bedtime recording */}
                  {isNight && (
                    <div style={{ marginTop: 14, borderTop: "1px solid #E5E7EB", paddingTop: 14 }}>
                      <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>Se durmió a las</div>
                      <input
                        type="time"
                        value={bedAsleep || ""}
                        onChange={e => setBedAsleep(e.target.value)}
                        style={timeInputStyle}
                      />
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
          </div>
        )}

        {/* ── COACH VIEW ── */}
        {view === "coach" && (
          <div>
            <Card>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
                Resumen del día
              </div>
              <div style={{ fontSize: 13, color: "#6B7280" }}>
                {new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
              </div>

              {/* Summary stats */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 16 }}>
                {[
                  { label: "Despertar", value: formatTime(wakeTime), icon: "☀️" },
                  {
                    label: "Total siestas",
                    value: (() => {
                      let mins = 0;
                      naps.forEach(n => {
                        if (n.asleepAt && n.wokeAt) mins += diffMinutes(n.asleepAt, n.wokeAt);
                      });
                      return mins > 0 ? `${Math.floor(mins/60)}h ${mins%60}m` : "—";
                    })(),
                    icon: "💤",
                  },
                  {
                    label: "A dormir",
                    value: bedAsleep ? formatTime(bedAsleep) : schedule[2]?.sleepTarget ? formatTime(schedule[2].sleepTarget) : "—",
                    icon: "🌙",
                  },
                ].map((stat, i) => (
                  <div key={i} style={{
                    background: "#F9FAFB",
                    borderRadius: 12,
                    padding: "12px 8px",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: 20 }}>{stat.icon}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginTop: 4 }}>{stat.value}</div>
                    <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>{stat.label}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Timeline chart */}
            <Card ref={chartRef}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 16 }}>
                📅 Línea de tiempo
              </div>
              <TimelineChart schedule={schedule} naps={naps} wakeTime={wakeTime} bedAsleep={bedAsleep} />
            </Card>

            {/* Nap details table */}
            <Card>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 12 }}>
                📋 Detalle de siestas
              </div>
              {schedule.slice(0, 2).map((s, i) => {
                const nap = naps[i];
                const dur = nap.asleepAt && nap.wokeAt ? diffMinutes(nap.asleepAt, nap.wokeAt) : null;
                return (
                  <div key={i} style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr 1fr",
                    gap: 6,
                    padding: "10px 0",
                    borderBottom: i === 0 ? "1px solid #E5E7EB" : "none",
                    fontSize: 13,
                  }}>
                    <div style={{ fontWeight: 700, color: "#111827" }}>{s.label}</div>
                    <div style={{ color: "#374151" }}>
                      {nap.asleepAt ? formatTime(nap.asleepAt) : <span style={{ color: "#D1D5DB" }}>—</span>}
                    </div>
                    <div style={{ color: "#374151" }}>
                      {nap.wokeAt ? formatTime(nap.wokeAt) : <span style={{ color: "#D1D5DB" }}>—</span>}
                    </div>
                    <div style={{
                      fontWeight: 600,
                      color: dur === null ? "#D1D5DB" : dur >= 90 ? "#059669" : "#D97706",
                    }}>
                      {dur !== null ? `${dur} min` : "—"}
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
                <div>Siesta</div><div>Inicio</div><div>Fin</div><div>Duración</div>
              </div>
            </Card>

            {/* Vs plan comparison */}
            <Card>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 12 }}>
                🎯 Real vs. Objetivo
              </div>
              {schedule.slice(0, 2).map((s, i) => {
                const nap = naps[i];
                const diff = nap.asleepAt ? diffMinutes(s.sleepTarget, nap.asleepAt) : null;
                return (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{s.label}</span>
                      {diff !== null && (
                        <span style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: Math.abs(diff) <= 15 ? "#059669" : Math.abs(diff) <= 30 ? "#D97706" : "#DC2626",
                        }}>
                          {diff === 0 ? "✅ Exacto" : diff > 0 ? `+${diff} min tarde` : `${Math.abs(diff)} min antes`}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ background: "#F9FAFB", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
                        <div style={{ color: "#6B7280" }}>Objetivo</div>
                        <div style={{ fontWeight: 700, color: "#111827" }}>{formatTime(s.sleepTarget)}</div>
                      </div>
                      <div style={{ background: "#ECFDF5", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
                        <div style={{ color: "#6B7280" }}>Real</div>
                        <div style={{ fontWeight: 700, color: "#059669" }}>{nap.asleepAt ? formatTime(nap.asleepAt) : "—"}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </Card>

            {/* Weekly history */}
            <Card>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 12 }}>
                📆 Historial de la semana
              </div>
              {(() => {
                const days = [];
                for (let i = 6; i >= 0; i--) {
                  const dateStr = getLimaDateOffset(-i);
                  const isToday = dateStr === TODAY;
                  const row = weekData.find(r => r.log_date === dateStr);
                  const d = new Date(dateStr + "T12:00:00");
                  days.push({ date: d, dateStr, row, isToday });
                }
                return days.map(({ date, row, isToday }, idx) => {
                  const label = isToday ? "Hoy" : date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" });
                  const wake = row?.wake_time;
                  const bed = row?.bed_asleep;
                  const napData = row?.naps || [];
                  let totalNapMins = 0;
                  napData.forEach(n => {
                    if (n.asleepAt && n.wokeAt && !n.didNotHappen)
                      totalNapMins += diffMinutes(n.asleepAt, n.wokeAt);
                  });
                  const hasData = !!wake;
                  return (
                    <div key={idx} style={{
                      display: "grid",
                      gridTemplateColumns: "60px 1fr 1fr 1fr",
                      gap: 6,
                      padding: "8px 0",
                      borderBottom: idx < 6 ? "1px solid #F3F4F6" : "none",
                      opacity: hasData ? 1 : 0.4,
                      fontSize: 12,
                      alignItems: "center",
                      background: isToday ? "#F5F3FF" : "transparent",
                      borderRadius: isToday ? 8 : 0,
                      paddingLeft: isToday ? 8 : 0,
                    }}>
                      <div style={{ fontWeight: isToday ? 700 : 500, color: isToday ? "#7C4DFF" : "#374151" }}>{label}</div>
                      <div style={{ color: "#6B7280" }}>☀️ {wake ? formatTime(wake) : "—"}</div>
                      <div style={{ color: "#6B7280" }}>💤 {totalNapMins > 0 ? `${Math.floor(totalNapMins/60)}h${totalNapMins%60}m` : "—"}</div>
                      <div style={{ color: "#6B7280" }}>🌙 {bed ? formatTime(bed) : "—"}</div>
                    </div>
                  );
                });
              })()}
            </Card>

            {/* Export button */}
            <button
              onClick={() => {
                const text = buildExportText(schedule, naps, wakeTime, bedAsleep);
                if (navigator.share) {
                  navigator.share({ title: "Reporte Camille", text });
                } else {
                  navigator.clipboard.writeText(text).then(() => alert("Copiado al portapapeles ✅"));
                }
              }}
              style={{
                width: "100%",
                padding: "16px",
                background: "linear-gradient(135deg, #7B5EA7, #5B4FCF)",
                color: "white",
                border: "none",
                borderRadius: 16,
                fontSize: 16,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "0 4px 16px rgba(123,94,167,0.4)",
                marginTop: 8,
              }}
            >
              📤 Exportar reporte para Sleep Coach
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Timeline Chart ─────────────────────────────────────────────
function TimelineChart({ schedule, naps, wakeTime, bedAsleep }) {
  const START_H = 6;
  const END_H = 22;
  const totalMin = (END_H - START_H) * 60;

  function pct(timeStr) {
    const [h, m] = timeStr.split(":").map(Number);
    const mins = h * 60 + m - START_H * 60;
    return Math.max(0, Math.min(100, (mins / totalMin) * 100));
  }

  const blocks = [];

  // Morning wake
  blocks.push({ type: "awake", start: wakeTime, end: null, color: "#FFE0A0", label: "Despierta" });

  schedule.forEach((s, i) => {
    if (i < 2) {
      const nap = naps[i];
      const start = nap.asleepAt || s.sleepTarget;
      const dur = nap.asleepAt && nap.wokeAt
        ? diffMinutes(nap.asleepAt, nap.wokeAt)
        : 70;
      const end = nap.wokeAt || addMinutes(start, dur);
      blocks.push({ type: "nap", start, end, color: s.color, label: s.label });
    } else {
      const start = bedAsleep || s.sleepTarget;
      blocks.push({ type: "bed", start, end: "22:00", color: s.color, label: "Noche" });
    }
  });

  const hours = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);

  return (
    <div>
      {/* Hour labels */}
      <div style={{ position: "relative", height: 20, marginBottom: 4 }}>
        {hours.filter(h => h % 2 === 0).map(h => (
          <div key={h} style={{
            position: "absolute",
            left: `${pct(`${String(h).padStart(2,"0")}:00`)}%`,
            transform: "translateX(-50%)",
            fontSize: 10,
            color: "#6B7280",
          }}>
            {h > 12 ? `${h-12}pm` : h === 12 ? "12pm" : `${h}am`}
          </div>
        ))}
      </div>

      {/* Track */}
      <div style={{
        position: "relative",
        height: 56,
        background: "#F3F4F6",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid #E5E7EB",
      }}>
        {/* Hour lines */}
        {hours.map(h => (
          <div key={h} style={{
            position: "absolute",
            left: `${pct(`${String(h).padStart(2,"0")}:00`)}%`,
            top: 0, bottom: 0,
            width: 1,
            background: "rgba(0,0,0,0.08)",
          }} />
        ))}

        {/* Awake bar */}
        {blocks.filter(b => b.type === "awake").map((b, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${pct(b.start)}%`,
            width: `${pct(b.end || "22:00") - pct(b.start)}%`,
            top: "30%", height: "40%",
            background: "#FDE68A",
            borderRadius: 4,
          }} />
        ))}

        {/* Nap/bed blocks */}
        {blocks.filter(b => b.type === "nap" || b.type === "bed").map((b, i) => {
          const left = pct(b.start);
          const right = pct(b.end);
          const width = right - left;
          return (
            <div key={i} style={{
              position: "absolute",
              left: `${left}%`,
              width: `${Math.max(width, 3)}%`,
              top: "10%", height: "80%",
              background: b.color,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 700,
              color: "white",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}>
              {width > 8 ? b.label : ""}
            </div>
          );
        })}

        {/* Now indicator */}
        {(() => {
          const now = new Date();
          const nowStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
          const pos = pct(nowStr);
          if (pos <= 0 || pos >= 100) return null;
          return (
            <div style={{
              position: "absolute",
              left: `${pos}%`,
              top: 0, bottom: 0,
              width: 2,
              background: "#E74C3C",
              zIndex: 5,
            }}>
              <div style={{
                position: "absolute",
                top: -4,
                left: -4,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#E74C3C",
              }} />
            </div>
          );
        })()}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        {[
          { color: "#FDE68A", label: "Despierta" },
          { color: "#00BCD4", label: "Siesta 1" },
          { color: "#43A047", label: "Siesta 2" },
          { color: "#7C4DFF", label: "Noche" },
          { color: "#EF4444", label: "Ahora" },
        ].map((l, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: l.color }} />
            <span style={{ fontSize: 11, color: "#6B7280" }}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Export text builder ────────────────────────────────────────
function buildExportText(schedule, naps, wakeTime, bedAsleep) {
  const date = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  let text = `🌙 REPORTE DE SUEÑO - CAMILLE\n${date}\n\n`;
  text += `☀️ Despertar: ${formatTime(wakeTime)}\n\n`;

  naps.forEach((nap, i) => {
    const s = schedule[i];
    text += `${s.label}:\n`;
    if (nap.didNotHappen) {
      text += `  · No ocurrió\n`;
    } else {
      text += `  · Objetivo: ${formatTime(s.sleepTarget)}\n`;
      text += `  · Se durmió: ${nap.asleepAt ? formatTime(nap.asleepAt) : "—"}\n`;
      text += `  · Despertó: ${nap.wokeAt ? formatTime(nap.wokeAt) : "—"}\n`;
      if (nap.asleepAt && s.enterRoom) {
        const ttf = Math.max(0, diffMinutes(s.enterRoom, nap.asleepAt));
        text += `  · Tiempo en dormirla: ${ttf} min\n`;
      }
      if (nap.asleepAt && nap.wokeAt) {
        const dur = diffMinutes(nap.asleepAt, nap.wokeAt);
        text += `  · Duración: ${dur} min (${dur >= 90 ? "✅ larga" : "⚠️ corta"})\n`;
      }
    }
    text += "\n";
  });

  text += `🌙 Noche:\n`;
  text += `  · Objetivo: ${formatTime(schedule[2].sleepTarget)}\n`;
  text += `  · Se durmió: ${bedAsleep ? formatTime(bedAsleep) : "—"}\n`;

  return text;
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
