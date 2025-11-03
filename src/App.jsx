// src/App.jsx — Full sticky header (title+controls+stats+daybar) + blur
// - Mobil uyum
// - Buluta kaydet / Buluttan yükle (manuel), autosave yok
// - Ay/yıl değişince ilgili ay verisi gelir; yoksa boş görünür
// - Gün barı ve satırlar yatay scroll’da senkron

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";

/* ====== Sabitler / Yardımcılar ====== */
const FIRST_COL_W = 320;   // Sol hedef sütunu (px)
const CELL_W = 44;         // Gün hücresi (px)
const COMPLETE_COL_W = 64; // %Tamam sütunu (px)

const UNIT_TYPES = [
  { id: "check", label: "Checkbox" },
  { id: "count", label: "Adet" },
  { id: "minutes", label: "Dakika" },
  { id: "ml", label: "mL" },
  { id: "grams", label: "Gram" },
];

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}
function todayParts() {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}
function monthNameTR(idx) {
  return [
    "Ocak","Şubat","Mart","Nisan","Mayıs","Haziran",
    "Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"
  ][idx];
}
function getDeviceId() {
  try {
    let id = localStorage.getItem("lc_device_id");
    if (!id) {
      id = (crypto?.randomUUID?.() ?? "dev-" + Math.random().toString(36).slice(2));
      localStorage.setItem("lc_device_id", id);
    }
    return id;
  } catch {
    return "dev-" + Math.random().toString(36).slice(2);
  }
}
const DEVICE_ID = getDeviceId();

const DEFAULT_HABITS = [
  { id: "wakeBefore9",   title: "9'dan önce kalk",           unit: "check",   target: 1 },
  { id: "sleepBefore11", title: "11'den önce yatağa gir",    unit: "check",   target: 1 },
  { id: "morningStretch",title: "Sabah egzersizi / esneme",  unit: "minutes", target: 15 },
  { id: "gym",           title: "Gym",                       unit: "minutes", target: 60 },
  { id: "aiBuild",       title: "AI Build Time",             unit: "minutes", target: 60 },
  { id: "read",          title: "Kitap okuma",               unit: "minutes", target: 15 },
  { id: "plan",          title: "Gün hedef planlama",        unit: "minutes", target: 5 },
  { id: "postural",      title: "Postural egzersiz",         unit: "minutes", target: 10 },
  { id: "protein",       title: "Protein",                   unit: "grams",   target: 80 },
  { id: "water",         title: "Su tüketimi",               unit: "ml",      target: 3000 },
  { id: "social",        title: "Sosyal zaman (isim yaz)",   unit: "count",   target: 1 },
  { id: "alcohol",       title: "Alkol (kadeh)",             unit: "count",   target: 0 },
];

const STORAGE_KEY = "lifestyle_challenge_state_v2";

/* ====== Supabase Snapshot API ====== */
async function saveDeviceSnapshot({ year, month, habits, data, title }) {
  const { error } = await supabase
    .from("snapshots")
    .upsert(
      { device_id: DEVICE_ID, year, month, payload: { year, month, habits, data, title } },
      { onConflict: "device_id,year,month" }
    );
  if (error) throw error;
}
async function loadDeviceSnapshot(year, month) {
  const { data: row, error } = await supabase
    .from("snapshots")
    .select("payload")
    .eq("device_id", DEVICE_ID)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  if (error) throw error;
  return row?.payload ?? null;
}
async function saveUserSnapshot(uid, { year, month, habits, data, title }) {
  const { error } = await supabase
    .from("user_snapshots")
    .upsert(
      { user_id: uid, year, month, payload: { year, month, habits, data, title } },
      { onConflict: "user_id,year,month" }
    );
  if (error) throw error;
}
async function loadUserSnapshot(uid, year, month) {
  const { data: row, error } = await supabase
    .from("user_snapshots")
    .select("payload")
    .eq("user_id", uid)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  if (error) throw error;
  return row?.payload ?? null;
}
async function migrateAllDeviceSnapshotsToUser(uid) {
  const { data: devRows, error } = await supabase
    .from("snapshots")
    .select("year,month,payload")
    .eq("device_id", DEVICE_ID);
  if (error) throw error;
  if (!devRows?.length) return 0;
  const toUpsert = devRows.map((r) => ({
    user_id: uid, year: r.year, month: r.month, payload: r.payload,
  }));
  const { error: upErr } = await supabase
    .from("user_snapshots")
    .upsert(toUpsert, { onConflict: "user_id,year,month" });
  if (upErr) throw upErr;
  return toUpsert.length;
}

/* ====== Uygulama ====== */
export default function App() {
  const { y: ty, m: tm, d: td } = todayParts();

  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);

  const [year, setYear] = useState(ty);
  const [month, setMonth] = useState(tm);
  const [habits, setHabits] = useState(DEFAULT_HABITS);
  const [data, setData] = useState({});
  const [title, setTitle] = useState("Lifestyle Challenge");
  const [editingHabit, setEditingHabit] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [syncInfo, setSyncInfo] = useState("");

  // Scroll sync refs
  const headerScrollRef = useRef(null);
  const bodyScrollRef = useRef(null);
  const syncing = useRef(false);

  // Tam header yüksekliği ölçümü (sticky altında overlap olmasın)
  const stickyRef = useRef(null);
  const [stickyH, setStickyH] = useState(0);
  useEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect?.height || 0;
      setStickyH(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dim = daysInMonth(year, month);
  const gridWidth = dim * CELL_W + COMPLETE_COL_W;

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setUser(data.session?.user || null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s || null);
      setUser(s?.user || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // local backup
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.year) setYear(parsed.year);
      if (typeof parsed.month === "number") setMonth(parsed.month);
      if (Array.isArray(parsed.habits)) setHabits(parsed.habits);
      if (parsed.data) setData(parsed.data);
      if (parsed.title) setTitle(parsed.title);
    } catch {}
  }, []);
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ year, month, habits, data, title })
    );
  }, [year, month, habits, data, title]);

  // Ay/yıl değişince ilgili snapshot
  useEffect(() => {
    (async () => {
      try {
        let payload = null;
        if (user?.id) payload = await loadUserSnapshot(user.id, year, month);
        else          payload = await loadDeviceSnapshot(year, month);

        if (payload) {
          setTitle(payload.title ?? "Lifestyle Challenge");
          setHabits(Array.isArray(payload.habits) ? payload.habits : DEFAULT_HABITS);
          setData(payload.data ?? {});
          setSyncInfo("Buluttan yüklendi");
        } else {
          setData({});
          setSyncInfo("Kayıt yok (boş)");
        }
      } catch {
        setSyncInfo("Bulut okuma hatası");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year, user?.id]);

  // İlk login: migrate
  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      try {
        const moved = await migrateAllDeviceSnapshotsToUser(user.id);
        if (moved) setSyncInfo(`Cihazdan hesaba ${moved} kayıt taşındı`);
        const latest = await loadUserSnapshot(user.id, year, month);
        if (latest) {
          setTitle(latest.title ?? "Lifestyle Challenge");
          setHabits(Array.isArray(latest.habits) ? latest.habits : DEFAULT_HABITS);
          setData(latest.data ?? {});
        }
      } catch (e) { console.error(e); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Scroll senkron
  useEffect(() => {
    const h = headerScrollRef.current;
    const b = bodyScrollRef.current;
    if (!h || !b) return;
    const onH = () => {
      if (syncing.current) return;
      syncing.current = true; b.scrollLeft = h.scrollLeft; syncing.current = false;
    };
    const onB = () => {
      if (syncing.current) return;
      syncing.current = true; h.scrollLeft = b.scrollLeft; syncing.current = false;
    };
    h.addEventListener("scroll", onH, { passive: true });
    b.addEventListener("scroll", onB, { passive: true });
    return () => { h.removeEventListener("scroll", onH); b.removeEventListener("scroll", onB); };
  }, []);

  /* ==== Hücre Yardımcıları ==== */
  const getCell = (hid, day) => data?.[hid]?.[day] ?? null;
  const setCell = (hid, day, value) =>
    setData((prev) => ({ ...prev, [hid]: { ...(prev[hid] || {}), [day]: value } }));

  function clearMonth() {
    if (!confirm("Bu ayın tüm işaretlemelerini silmek istiyor musun?")) return;
    const cloned = { ...data };
    habits.forEach((h) => {
      if (cloned[h.id]) {
        const c = { ...cloned[h.id] };
        for (let d = 1; d <= dim; d++) delete c[d];
        cloned[h.id] = c;
      }
    });
    setData(cloned);
  }

  function exportJSON() {
    const blob = new Blob(
      [JSON.stringify({ year, month, habits, data, title }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_")}_${year}-${String(month + 1).padStart(2,"0")}.json`;
    a.click(); URL.revokeObjectURL(url);
  }
  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result));
        if (obj.title) setTitle(obj.title);
        if (obj.year) setYear(obj.year);
        if (typeof obj.month === "number") setMonth(obj.month);
        if (Array.isArray(obj.habits)) setHabits(obj.habits);
        if (obj.data) setData(obj.data);
      } catch { alert("Geçersiz JSON"); }
    };
    reader.readAsText(file);
  }

  function addHabit() {
    const base = { id: `habit_${Date.now()}`, title: "Yeni hedef", unit: "check", target: 1 };
    setHabits((h) => [...h, base]); setEditingHabit(base);
  }
  function removeHabit(id) {
    if (!confirm("Bu hedefi silmek istiyor musun?")) return;
    setHabits((p) => p.filter((h) => h.id !== id));
    setData((p) => { const c = { ...p }; delete c[id]; return c; });
  }
  function cycleValue(h, cur) {
    if (h.unit === "check") return cur ? 0 : 1;
    if (h.unit === "count") return (Number(cur) || 0) + 1;
    if (h.unit === "minutes") return (Number(cur) || 0) + 5;
    if (h.unit === "ml") return (Number(cur) || 0) + 250;
    if (h.unit === "grams") return (Number(cur) || 0) + 10;
    return cur;
  }
  function scoreFor(h, d) {
    const v = getCell(h.id, d);
    if (v == null) return 0;
    if (h.unit === "check") return v ? 1 : 0;
    if (["count","minutes","ml","grams"].includes(h.unit))
      return Math.min(1, Number(v) / Number(h.target || 1));
    return 0;
  }
  const dailyScores = useMemo(() => {
    const arr = [];
    for (let d = 1; d <= dim; d++) {
      const s = habits.reduce((a, h) => a + scoreFor(h, d), 0);
      arr.push(s / Math.max(1, habits.length));
    }
    return arr;
  }, [habits, data, dim]);
  function longestStreak() {
    let best = 0, cur = 0;
    for (let d = 1; d <= dim; d++) {
      if (dailyScores[d - 1] >= 0.8) { cur++; best = Math.max(best, cur); }
      else cur = 0;
    }
    return best;
  }

  /* ==== Bulut (manuel) ==== */
  async function handleCloudLoad() {
    try {
      let payload = null;
      if (user?.id) {
        payload = await loadUserSnapshot(user.id, year, month);
        if (!payload) {
          const dev = await loadDeviceSnapshot(year, month);
          if (dev) { await saveUserSnapshot(user.id, dev); payload = dev; }
        }
      } else {
        payload = await loadDeviceSnapshot(year, month);
      }
      if (!payload) { setData({}); setSyncInfo("Kayıt bulunamadı (boş)"); return; }
      setTitle(payload.title ?? "Lifestyle Challenge");
      setHabits(Array.isArray(payload.habits) ? payload.habits : DEFAULT_HABITS);
      setData(payload.data ?? {});
      setSyncInfo("Buluttan yüklendi");
    } catch (e) { console.error(e); setSyncInfo("Buluttan yüklenemedi"); }
  }
  async function handleCloudSave() {
    try {
      const payload = { year, month, habits, data, title };
      if (user?.id) await saveUserSnapshot(user.id, payload);
      else          await saveDeviceSnapshot(payload);
      setSyncInfo("Buluta kaydedildi");
    } catch (e) { console.error(e); setSyncInfo("Buluta kaydedilemedi"); }
  }

  /* ==== Auth ==== */
  async function signInWithEmail(email) {
    const { error } = await supabase.auth.signInWithOtp({
      email, options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
    alert("Giriş linki e-postana gönderildi.");
  }
  async function signOut() { await supabase.auth.signOut(); }

  /* ====== Alt Parçalar ====== */
  const StatCard = ({ label, value, bar }) => (
    <div className="rounded-2xl bg-neutral-900/80 border border-neutral-800 p-4">
      <div className="text-neutral-400 text-sm">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {typeof bar === "number" && (
        <div className="mt-2 h-2 rounded bg-neutral-800 overflow-hidden">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, bar * 100))}%` }} />
        </div>
      )}
    </div>
  );
  const Stats = () => (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard label="Gün sayısı" value={dim} />
      <StatCard
        label="Ay ilerleme"
        value={`${Math.round((dailyScores.filter(x => x > 0).length / dim) * 100)}%`}
        bar={dailyScores.filter(x => x > 0).length / Math.max(1, dim)}
      />
      <StatCard
        label="Ortalama gün skoru"
        value={`${Math.round((dailyScores.reduce((a,b)=>a+b,0) / Math.max(1,dailyScores.length))*100)}%`}
        bar={dailyScores.reduce((a,b)=>a+b,0) / Math.max(1,dailyScores.length)}
      />
      <StatCard label="En uzun streak (≥%80)" value={longestStreak()} />
    </section>
  );

  /* ====== Render ====== */
  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      {/* === TÜM HEADER (sticky) === */}
      <div
        ref={stickyRef}
        className="sticky top-0 z-50 bg-neutral-950/80 backdrop-blur border-b border-neutral-800 px-3 sm:px-4 md:px-6 pt-3 pb-3"
      >
        {/* Başlık + kontroller */}
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <input
            className="bg-transparent text-2xl md:text-3xl font-semibold outline-none border-b border-neutral-700 focus:border-neutral-400 w-full md:w-auto"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{monthNameTR(i)}</option>)}
            </select>
            <input
              type="number"
              className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 w-28"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />

            <button onClick={() => setShowSettings(s=>!s)} className="inline-flex items-center gap-2 bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 hover:bg-neutral-800">Ayarlar</button>
            <button onClick={exportJSON} className="inline-flex items-center gap-2 bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 hover:bg-neutral-800">Dışa aktar</button>
            <label className="inline-flex items-center gap-2 bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 hover:bg-neutral-800 cursor-pointer">
              İçe aktar
              <input type="file" accept="application/json" className="hidden" onChange={(e)=>e.target.files?.[0] && importJSON(e.target.files[0])}/>
            </label>
            <button onClick={clearMonth} className="inline-flex items-center gap-2 bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 hover:bg-neutral-800">Ayı temizle</button>
            <button onClick={handleCloudLoad} className="inline-flex items-center gap-2 bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 hover:bg-neutral-800">Buluttan yükle</button>
            <button onClick={handleCloudSave} className="inline-flex items-center gap-2 bg-blue-600 text-white rounded-xl px-3 py-2 hover:bg-blue-500">Buluta kaydet</button>
            <AuthPanel onSignIn={signInWithEmail} onSignOut={signOut} session={session} user={user}/>
          </div>
        </div>

        {syncInfo && <div className="mt-2 text-xs text-neutral-400">{syncInfo}</div>}

        {/* İstatistikler */}
        <div className="mt-3">
          <Stats />
        </div>

        {/* Gün Barı */}
        <div className="mt-4 flex">
          <div className="shrink-0 text-sm text-neutral-300 px-3 py-2" style={{ width: FIRST_COL_W }}>
            Hedef
          </div>
          <div ref={headerScrollRef} className="overflow-x-auto" style={{ width: "100%" }}>
            <div
              className="grid text-neutral-300"
              style={{
                minWidth: dim * CELL_W + COMPLETE_COL_W,
                gridTemplateColumns: `repeat(${dim}, ${CELL_W}px) ${COMPLETE_COL_W}px`,
              }}
            >
              {Array.from({ length: dim }, (_, i) => (
                <div key={i} className="px-1 py-2 text-center text-xs font-medium">
                  {i + 1}
                </div>
              ))}
              <div className="px-1 py-2 text-center text-xs font-medium">%Tamam</div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky header yüksekliği kadar üst boşluk (ilk içerik üstten gizlenmesin) */}
      <div style={{ height: stickyH ? 0 : 0 }} /> {/* sticky eleman flow'da olduğu için ekstra spacer gerekmiyor; bırakıyorum */}

      {/* === Gövde === */}
      <main className="px-3 sm:px-4 md:px-6 pb-8">
        <div ref={bodyScrollRef} className="overflow-x-auto rounded-2xl border border-neutral-800">
          <div className="divide-y divide-neutral-900" style={{ minWidth: FIRST_COL_W + gridWidth }}>
            {habits.map((h) => {
              let s = 0; for (let d = 1; d <= dim; d++) s += scoreFor(h, d);
              const pct = Math.round((s / dim) * 100);

              return (
                <div key={h.id} className="flex odd:bg-neutral-950 even:bg-neutral-900/40">
                  {/* Sol hedef sütunu (sticky) */}
                  <div
                    className="shrink-0 px-3 py-2 sticky left-0 z-10 bg-neutral-950/90 backdrop-blur"
                    style={{ width: FIRST_COL_W }}
                  >
                    <div className="font-medium leading-tight">{h.title}</div>
                    <div className="text-xs text-neutral-400">
                      Birim: {UNIT_TYPES.find(u=>u.id===h.unit)?.label} · Hedef: {h.target}
                    </div>
                    <div className="mt-1 flex gap-2">
                      <button onClick={()=>setEditingHabit(h)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-700 hover:bg-neutral-800">Düzenle</button>
                      <button onClick={()=>removeHabit(h.id)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-red-700/70 text-red-300 hover:bg-red-900/20">Sil</button>
                    </div>
                  </div>

                  {/* Gün hücreleri + %Tamam */}
                  <div
                    className="grid items-center"
                    style={{ gridTemplateColumns: `repeat(${dim}, ${CELL_W}px) ${COMPLETE_COL_W}px` }}
                  >
                    {Array.from({ length: dim }, (_, i) => {
                      const day = i + 1;
                      const val = getCell(h.id, day);
                      const score = scoreFor(h, day);
                      const isToday = year === ty && month === tm && day === td;

                      return (
                        <div key={day} className="px-1 py-1">
                          <button
                            onClick={() => setCell(h.id, day, cycleValue(h, val))}
                            onContextMenu={(e) => { e.preventDefault(); setCell(h.id, day, null); }}
                            className={`h-8 rounded-lg border text-sm select-none block mx-auto ${
                              score >= 1
                                ? "bg-green-600/30 border-green-600/60"
                                : score > 0
                                ? "bg-amber-600/20 border-amber-600/50"
                                : "bg-neutral-900 border-neutral-800"
                            } ${isToday ? "ring-2 ring-blue-500" : ""}`}
                            style={{ width: CELL_W - 8 }}
                            title="Sol tık: artır / sağ tık: temizle"
                          >
                            {h.unit === "check" ? (val ? "✓" : "") : (val ?? "")}
                          </button>
                        </div>
                      );
                    })}
                    <div className="px-1 py-1 text-center text-sm">
                      <span className={pct>=80?'text-green-400':'text-neutral-300'}>{pct}%</span>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="px-3 py-3">
              <button onClick={addHabit} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600/20 border border-blue-500/40 hover:bg-blue-600/30">
                + Yeni hedef ekle
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 text-sm text-neutral-400">
          İpucu: Hücreye tıklayınca değer artar, sağ tıkla temizlenir. %80 ve üzeri günler streak sayılır.
        </div>
      </main>

      {editingHabit && (
        <HabitEditor
          habit={editingHabit}
          onClose={() => setEditingHabit(null)}
          onSave={(u) => { setHabits(p => p.map(h => h.id===u.id ? u : h)); setEditingHabit(null); }}
        />
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}

/* ====== Modal/Panel Bileşenleri ====== */
function HabitEditor({ habit, onClose, onSave }) {
  const [title, setTitle] = useState(habit.title);
  const [unit, setUnit]   = useState(habit.unit);
  const [target, setTarget] = useState(habit.target);
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-lg rounded-2xl bg-neutral-950 border border-neutral-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Hedefi Düzenle</div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-200">Kapat</button>
        </div>
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm text-neutral-300">Başlık</span>
            <input value={title} onChange={(e)=>setTitle(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2"/>
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-neutral-300">Birim</span>
            <select value={unit} onChange={(e)=>setUnit(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2">
              {UNIT_TYPES.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-neutral-300">Günlük Hedef</span>
            <input type="number" value={target} onChange={(e)=>setTarget(Number(e.target.value))} className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2"/>
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="px-3 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-800">Vazgeç</button>
            <button onClick={()=>onSave({ ...habit, title, unit, target })} className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-500">Kaydet</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function SettingsPanel({ onClose }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-2xl rounded-2xl bg-neutral-950 border border-neutral-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Ayarlar</div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-200">Kapat</button>
        </div>
        <div className="space-y-2 text-sm text-neutral-300">
          <p>• Veriler tarayıcıda <b>localStorage</b>'da saklanır. JSON dışa aktarım ile yedek alabilirsin.</p>
          <p>• Hücreye <b>sol tık</b> → artır; <b>sağ tık</b> → temizle.</p>
          <p>• Streak: Gün ortalaması ≥%80 olduğunda ardışık gün sayısı artar.</p>
        </div>
      </div>
    </div>
  );
}
function AuthPanel({ onSignIn, onSignOut, session, user }) {
  const [email, setEmail] = useState("");
  if (session) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-neutral-300">{user?.email}</span>
        <span className="text-xs px-2 py-1 rounded-lg border border-green-600/50 text-green-300">Bulut: Kullanıcı</span>
        <button onClick={onSignOut} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 hover:bg-neutral-800">Çıkış</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="email@ornek.com" className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2"/>
      <span className="text-xs px-2 py-1 rounded-lg border border-neutral-600/50 text-neutral-300">Bulut: Cihaz</span>
      <button onClick={()=>email && onSignIn(email)} className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-500">Giriş linki gönder</button>
    </div>
  );
}
