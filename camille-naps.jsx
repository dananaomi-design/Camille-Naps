import { useState, useRef, useEffect } from "react";

// ── PWA / Launcher icon injection ────────────────────────────
function useLauncherIcon() {
  useEffect(() => {
    // Generate a canvas-based icon and inject it as apple-touch-icon + favicon
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 192;
    const ctx = canvas.getContext("2d");

    // Background circle
    const grad = ctx.createLinearGradient(0, 0, 192, 192);
    grad.addColorStop(0, "#7C4DFF");
    grad.addColorStop(1, "#00BCD4");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(0, 0, 192, 192, 40);
    ctx.fill();

    // Moon emoji-style crescent
    ctx.fillStyle = "white";
    ctx.font = "bold 110px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🌙", 96, 100);

    const dataUrl = canvas.toDataURL("image/png");

    // Apple touch icon
    let apple = document.querySelector("link[rel='apple-touch-icon']");
    if (!apple) {
      apple = document.createElement("link");
      apple.rel = "apple-touch-icon";
      document.head.appendChild(apple);
    }
    apple.href = dataUrl;

    // Favicon
    let favicon = document.querySelector("link[rel='icon']");
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.appendChild(favicon);
    }
    favicon.href = dataUrl;

    // Page title
    document.title = "Camille · Sueño";

    // Web app manifest for Android "Add to Home Screen"
    const manifest = {
      name: "Camille · Sueño",
      short_name: "Camille",
      start_url: "/",
      display: "standalone",
      background_color: "#E8E8EC",
      theme_color: "#7C4DFF",
      icons: [{ src: dataUrl, sizes: "192x192", type: "image/png" }],
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
    const manifestUrl = URL.createObjectURL(blob);
    let manifestLink = document.querySelector("link[rel='manifest']");
    if (!manifestLink) {
      manifestLink = document.createElement("link");
      manifestLink.rel = "manifest";
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = manifestUrl;

    // iOS standalone meta tags
    let metaCapable = document.querySelector("meta[name='apple-mobile-web-app-capable']");
    if (!metaCapable) {
      metaCapable = document.createElement("meta");
      metaCapable.name = "apple-mobile-web-app-capable";
      document.head.appendChild(metaCapable);
    }
    metaCapable.content = "yes";

    let metaTitle = document.querySelector("meta[name='apple-mobile-web-app-title']");
    if (!metaTitle) {
      metaTitle = document.createElement("meta");
      metaTitle.name = "apple-mobile-web-app-title";
      document.head.appendChild(metaTitle);
    }
    metaTitle.content = "Camille";

    return () => URL.revokeObjectURL(manifestUrl);
  }, []);
}

// ── Constants ────────────────────────────────────────────────
const WINDOWS = [
  { label: "Siesta 1", windowMin: 190, color: "#00BCD4" },   // 3h10 — cyan vivo
  { label: "Siesta 2", windowMin: 220, color: "#43A047" },   // 3h40 — verde vivo
  { label: "Noche",    windowMin: 180, color: "#7C4DFF" },   // 3h00 — violeta vivo
];
const ROUTINE_MIN = 15; // enter room this many minutes before sleep target

function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

function diffMinutes(a, b) {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return (bh * 60 + bm) - (ah * 60 + am);
}

function formatTime(t) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${suffix}`;
}

function timeToFrac(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return (h * 60 + m) / (24 * 60);
}

// ── Main Component ────────────────────────────────────────────
export default function CamilleNaps() {
  useLauncherIcon();
  const [view, setView] = useState("nanny"); // "nanny" | "coach"
  const [wakeTime, setWakeTime] = useState("07:00");
  const [naps, setNaps] = useState([
    { asleepAt: null, wokeAt: null, long: null },
    { asleepAt: null, wokeAt: null, long: null },
  ]);
  const [bedAsleep, setBedAsleep] = useState(null);
  const chartRef = useRef(null);

  // Compute schedule from wake time + actual nap data
  function getSchedule() {
    const schedule = [];
    let currentWake = wakeTime;

    for (let i = 0; i < 3; i++) {
      const win = WINDOWS[i];
      const isNight = i === 2;

      // Adjust window if previous nap was short (only for nap 2)
      let windowMin = win.windowMin;
      if (i === 1 && naps[0].long === false) windowMin = Math.max(windowMin - 20, 150);

      const sleepTarget = addMinutes(currentWake, windowMin);
      const enterRoom   = addMinutes(sleepTarget, -ROUTINE_MIN);

      const actual = isNight ? bedAsleep : naps[i]?.asleepAt;
      const woke   = isNight ? null : naps[i]?.wokeAt;
      const long   = isNight ? null : naps[i]?.long;

      schedule.push({
        label: win.label,
        color: win.color,
        windowMin,
        enterRoom,
        sleepTarget,
        actual,
        woke,
        long,
        currentWake,
      });

      // next wake = actual wake from nap, or estimated
      if (!isNight) {
        if (woke) {
          currentWake = woke;
        } else if (actual) {
          // estimate: asleep + 60 min if no wake recorded
          currentWake = addMinutes(actual, 60);
        } else {
          currentWake = addMinutes(sleepTarget, 75);
        }
      }
    }
    return schedule;
  }

  const schedule = getSchedule();

  function recordNapAsleep(i, time) {
    setNaps(prev => {
      const n = [...prev];
      n[i] = { ...n[i], asleepAt: time };
      return n;
    });
  }

  function recordNapWoke(i, time) {
    setNaps(prev => {
      const n = [...prev];
      const asleep = n[i].asleepAt;
      const dur = asleep ? diffMinutes(asleep, time) : 0;
      n[i] = { ...n[i], wokeAt: time, long: dur >= 60 };
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
            {/* Wake time input */}
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
              const nap = naps[i];

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

                  {/* Calculated times */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
                    <TimeBox
                      icon="🚪"
                      label="Entrar al cuarto"
                      time={s.enterRoom}
                      highlight
                    />
                    <TimeBox
                      icon="😴"
                      time={s.sleepTarget}
                      label="Debe dormirse"
                    />
                  </div>

                  {/* Actual recording (naps only) */}
                  {!isNight && (
                    <div style={{ marginTop: 14, borderTop: "1px solid #E5E7EB", paddingTop: 14 }}>
                      <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 8, fontStyle: "italic" }}>
                        Registrar lo que pasó:
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, minWidth: 0 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>Se durmió a las</div>
                          <input
                            type="time"
                            value={nap.asleepAt || ""}
                            onChange={e => recordNapAsleep(i, e.target.value)}
                            style={timeInputStyle}
                          />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>Despertó a las</div>
                          <input
                            type="time"
                            value={nap.wokeAt || ""}
                            onChange={e => recordNapWoke(i, e.target.value)}
                            style={timeInputStyle}
                          />
                        </div>
                      </div>

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
                            : `⚠️ Siesta corta (${diffMinutes(nap.asleepAt, nap.wokeAt)} min) · Ajustando ventana siguiente`}
                        </div>
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

            <div style={{ fontSize: 12, color: "#4B5563", textAlign: "center", marginTop: 8, fontStyle: "italic" }}>
              Rutina de entrada: 15 min antes de la hora objetivo
            </div>
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
                      color: dur === null ? "#D1D5DB" : dur >= 60 ? "#059669" : "#D97706",
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
    text += `  · Objetivo: ${formatTime(s.sleepTarget)}\n`;
    text += `  · Se durmió: ${nap.asleepAt ? formatTime(nap.asleepAt) : "—"}\n`;
    text += `  · Despertó: ${nap.wokeAt ? formatTime(nap.wokeAt) : "—"}\n`;
    if (nap.asleepAt && nap.wokeAt) {
      const dur = diffMinutes(nap.asleepAt, nap.wokeAt);
      text += `  · Duración: ${dur} min (${dur >= 60 ? "✅ larga" : "⚠️ corta"})\n`;
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
  padding: "10px 10px",
  border: "2px solid #E5E7EB",
  borderRadius: 12,
  fontSize: 16,
  fontFamily: "inherit",
  color: "#111827",
  fontWeight: 700,
  background: "#F9FAFB",
  boxSizing: "border-box",
  outline: "none",
  minWidth: 0,
  display: "block",
};
