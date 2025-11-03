// src/App.jsx — Lifestyle Challenge (REV: mobil 2×2 stats, 2‑yönlü senkron scroll, tam hizalama)
// - Mobil uyumluluk güçlendirildi: dokunmatik hedefler büyütüldü, spacing ve kontrast iyileştirildi
// - İstatistik kutuları (ilerleme boxları) mobilde 2×2 grid, md ve üstü 4 sütun
// - Gün başlığı ve içerik HİÇ KAYMA olmadan iki yönlü senkron scroll
// - Sol "Hedef" sütunu ile üst başlıktaki "Hedef" başlığı birebir genişlik eşleşmesi (ResizeObserver)
// - Ortak sütun genişliği değişkenleri (CSS var): day width ve left col width
// - Sticky header’lar ve yatay çizgiler sade, profesyonel görünüm için optimize edildi
// - Perf: passive scroll dinleyicileri + rAF ile senkronizasyon

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';

// -------------------- Yardımcılar --------------------
const UNIT_TYPES = [
  { id: 'check', label: 'Checkbox' },
  { id: 'count', label: 'Adet' },
  { id: 'minutes', label: 'Dakika' },
  { id: 'ml', label: 'mL' },
  { id: 'grams', label: 'Gram' },
];

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}
function todayParts() {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}
function monthNameTR(idx) {
  return ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'][idx];
}
function getDeviceId() {
  try {
    let id = localStorage.getItem('lc_device_id');
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'dev-' + Math.random().toString(36).slice(2);
      localStorage.setItem('lc_device_id', id);
    }
    return id;
  } catch {
    return 'dev-' + Math.random().toString(36).slice(2);
  }
}
const DEVICE_ID = getDeviceId();

const DEFAULT_HABITS = [
  { id: 'wakeBefore9',   title: "9'dan önce kalk",           unit: 'check',   target: 1 },
  { id: 'sleepBefore11', title: "11'den önce yatağa gir",    unit: 'check',   target: 1 },
  { id: 'morningStretch',title: 'Sabah egzersizi / esneme',  unit: 'minutes', target: 15 },
  { id: 'gym',           title: 'Gym',                       unit: 'minutes', target: 60 },
  { id: 'aiBuild',       title: 'AI Build Time',             unit: 'minutes', target: 60 },
  { id: 'read',          title: 'Kitap okuma',               unit: 'minutes', target: 15 },
  { id: 'plan',          title: 'Gün hedef planlama',        unit: 'minutes', target: 5 },
  { id: 'postural',      title: 'Postural egzersiz',         unit: 'minutes', target: 10 },
  { id: 'protein',       title: 'Protein',                   unit: 'grams',   target: 80 },
  { id: 'water',         title: 'Su tüketimi',               unit: 'ml',      target: 3000 },
  { id: 'social',        title: 'Sosyal zaman (isim yaz)',   unit: 'count',   target: 1 },
  { id: 'alcohol',       title: 'Alkol (kadeh)',             unit: 'count',   target: 0 },
];

const STORAGE_KEY = 'lifestyle_challenge_state_v1';

// -------------------- Supabase: Snapshot API --------------------
async function saveDeviceSnapshot({ year, month, habits, data, title }) {
  const { error } = await supabase.from('snapshots').upsert(
    { device_id: DEVICE_ID, year, month, payload: { year, month, habits, data, title } },
    { onConflict: 'device_id,year,month' }
  );
  if (error) throw error;
}
async function loadDeviceSnapshot(year, month) {
  const { data: row, error } = await supabase
    .from('snapshots')
    .select('payload')
    .eq('device_id', DEVICE_ID)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();
  if (error) throw error;
  return row?.payload ?? null;
}

async function saveUserSnapshot(uid, { year, month, habits, data, title }) {
  const { error } = await supabase.from('user_snapshots').upsert(
    { user_id: uid, year, month, payload: { year, month, habits, data, title } },
    { onConflict: 'user_id,year,month' }
  );
  if (error) throw error;
}
async function loadUserSnapshot(uid, year, month) {
  const { data: row, error } = await supabase
    .from('user_snapshots')
    .select('payload')
    .eq('user_id', uid)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();
  if (error) throw error;
  return row?.payload ?? null;
}

export default function App() {
  const { y: ty, m: tm, d: td } = todayParts();

  // Auth
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);

  // UI + veri
  const [year, setYear] = useState(ty);
  const [month, setMonth] = useState(tm); // 0-11
  const [habits, setHabits] = useState(DEFAULT_HABITS);
  const [data, setData] = useState({});
  const [title, setTitle] = useState('Lifestyle Challenge');
  const [editingHabit, setEditingHabit] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [syncInfo, setSyncInfo] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Ölçüm/senkron referansları
  const daysHeaderRef = useRef(null);     // üst gün şeridi (yatay kaydırılır)
  const bodyScrollRef = useRef(null);     // tablo gövdesi yatay kaydırıcı
  const leftCellProbeRef = useRef(null);  // ilk sol hücreyi gözleyip genişlik ölçer

  // Ortak genişlikler (CSS var). Başlangıç varsayılanları:
  const [leftColW, setLeftColW] = useState(320); // px
  const [dayColW] = useState(40);                // px — tüm gün sütunları eşit

  // --- Auth subscribe ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setUser(data.session?.user || null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess || null);
      setUser(sess?.user || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- localStorage load/save ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.year) setYear(parsed.year);
      if (typeof parsed.month === 'number') setMonth(parsed.month);
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

  const dim = daysInMonth(year, month);

  // --- Hücre yardımcıları ---
  function getCell(hid, day) { return data?.[hid]?.[day] ?? null; }
  function setCell(hid, day, value) {
    setData(prev => ({ ...prev, [hid]: { ...(prev[hid] || {}), [day]: value } }));
  }

  function clearMonth() {
    if (!confirm('Bu ayın tüm işaretlemelerini silmek istiyor musun?')) return;
    const cloned = { ...data };
    habits.forEach(h => {
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
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_')}_${year}-${String(month + 1).padStart(2, '0')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result));
        if (obj.title) setTitle(obj.title);
        if (obj.year) setYear(obj.year);
        if (typeof obj.month === 'number') setMonth(obj.month);
        if (Array.isArray(obj.habits)) setHabits(obj.habits);
        if (obj.data) setData(obj.data);
      } catch { alert('Geçersiz JSON'); }
    };
    reader.readAsText(file);
  }

  function addHabit() {
    const base = { id: `habit_${Date.now()}`, title: 'Yeni hedef', unit: 'check', target: 1 };
    setHabits(h => [...h, base]);
    setEditingHabit(base);
  }
  function removeHabit(id) {
    if (!confirm('Bu hedefi silmek istiyor musun?')) return;
    setHabits(prev => prev.filter(h => h.id !== id));
    setData(prev => { const c = { ...prev }; delete c[id]; return c; });
  }

  function cycleValue(habit, current) {
    if (habit.unit === 'check')   return current ? 0 : 1;
    if (habit.unit === 'count')   return (Number(current) || 0) + 1;
    if (habit.unit === 'minutes') return (Number(current) || 0) + 5;
    if (habit.unit === 'ml')      return (Number(current) || 0) + 250;
    if (habit.unit === 'grams')   return (Number(current) || 0) + 10;
    return current;
  }

  function scoreFor(habit, day) {
    const v = getCell(habit.id, day);
    if (v == null) return 0;
    if (habit.unit === 'check') return v ? 1 : 0;
    if (['count', 'minutes', 'ml', 'grams'].includes(habit.unit)) {
      return Math.min(1, Number(v) / Number(habit.target || 1));
    }
    return 0;
  }

  const dailyScores = useMemo(() => {
    const arr = [];
    for (let d = 1; d <= dim; d++) {
      const s = habits.reduce((acc, h) => acc + scoreFor(h, d), 0);
      arr.push(s / Math.max(1, habits.length));
    }
    return arr;
  }, [habits, data, dim]);

  function longestStreak() {
    let best = 0, cur = 0;
    for (let d = 1; d <= dim; d++) {
      if (dailyScores[d - 1] >= 0.8) { cur += 1; best = Math.max(best, cur); }
      else cur = 0;
    }
    return best;
  }

  // -------------------- Manuel Bulut İşlemleri --------------------
  async function handleCloudLoad() {
    try {
      let payload = null;

      if (user?.id) {
        payload = await loadUserSnapshot(user.id, year, month);
        if (!payload) {
          const dev = await loadDeviceSnapshot(year, month);
          if (dev) {
            await saveUserSnapshot(user.id, dev);
            payload = dev;
          }
        }
      } else {
        payload = await loadDeviceSnapshot(year, month);
      }

      if (!payload) { setSyncInfo('Kayıt bulunamadı'); return; }

      setTitle(payload.title ?? 'Lifestyle Challenge');
      setHabits(Array.isArray(payload.habits) ? payload.habits : DEFAULT_HABITS);
      setData(payload.data ?? {});
      setSyncInfo('Buluttan yüklendi');
    } catch (e) {
      console.error(e);
      setSyncInfo('Buluttan yüklenemedi');
    }
  }

  async function migrateAllDeviceSnapshotsToUser(uid) {
    const { data: devRows, error } = await supabase
      .from('snapshots')
      .select('year, month, payload')
      .eq('device_id', DEVICE_ID);
    if (error) throw error;
    if (!devRows?.length) return 0;

    const toUpsert = devRows.map(r => ({
      user_id: uid,
      year: r.year,
      month: r.month,
      payload: r.payload
    }));
    const { error: upErr } = await supabase
      .from('user_snapshots')
      .upsert(toUpsert, { onConflict: 'user_id,year,month' });
    if (upErr) throw upErr;
    return toUpsert.length;
  }

  async function handleCloudSave() {
    try {
      const payload = { year, month, habits, data, title };
      if (user?.id) await saveUserSnapshot(user.id, payload);
      else          await saveDeviceSnapshot(payload);
      setSyncInfo('Buluta kaydedildi');
    } catch (e) {
      console.error(e);
      setSyncInfo('Buluta kaydedilemedi');
    }
  }

  // İlk oturum açıldığında: varsa device snapshot'ını user'a taşı ve o ayı yükle
  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      try {
        const moved = await migrateAllDeviceSnapshotsToUser(user.id);
        if (moved) setSyncInfo(`Cihazdan hesaba ${moved} kayıt taşındı`);
        const latest = await loadUserSnapshot(user.id, year, month);
        if (latest) {
          setTitle(latest.title ?? 'Lifestyle Challenge');
          setHabits(Array.isArray(latest.habits) ? latest.habits : DEFAULT_HABITS);
          setData(latest.data ?? {});
        }
      } catch (e) { console.error(e); }
    })();
  }, [user?.id]);

  // --- Ay değişince ilgili veriyi getir (boşsa boş gelsin) ---
  useEffect(() => {
    (async () => {
      try {
        let payload = null;
        if (user?.id) payload = await loadUserSnapshot(user.id, year, month);
        else          payload = await loadDeviceSnapshot(year, month);
        if (payload) {
          setTitle(payload.title ?? 'Lifestyle Challenge');
          setHabits(Array.isArray(payload.habits) ? payload.habits : DEFAULT_HABITS);
          setData(payload.data ?? {});
        } else {
          setData({});
        }
      } catch (e) { console.error(e); }
    })();
  }, [year, month, user?.id]);

  // --- Sol sütun genişliği ölçümü (header ile birebir eşleşme) ---
  useEffect(() => {
    if (!leftCellProbeRef.current) return;
    const el = leftCellProbeRef.current;
    const obs = new ResizeObserver(() => {
      // scrollWidth ile padding/border dahil genişlik al
      const w = Math.ceil(el.getBoundingClientRect().width);
      setLeftColW(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [habits.length]);

  // --- İki yönlü yatay scroll senkronizasyonu ---
  useEffect(() => {
    const head = daysHeaderRef.current;
    const body = bodyScrollRef.current;
    if (!head || !body) return;

    let syncing = false;
    const sync = (from, to) => {
      if (syncing) return;
      syncing = true;
      const x = from.scrollLeft;
      // rAF ile hassas eşleme + mobilde akıcılık
      requestAnimationFrame(() => {
        to.scrollLeft = x;
        syncing = false;
      });
    };

    const onHead = () => sync(head, body);
    const onBody = () => sync(body, head);

    head.addEventListener('scroll', onHead, { passive: true });
    body.addEventListener('scroll', onBody, { passive: true });

    return () => {
      head.removeEventListener('scroll', onHead);
      body.removeEventListener('scroll', onBody);
    };
  }, []);

  // -------------------- Auth Fonksiyonları --------------------
  async function signInWithEmail(email) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) throw error;
    alert('Giriş linki e-postana gönderildi.');
  }
  async function signOut() { await supabase.auth.signOut(); }

  // -------------------- Render --------------------
  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100" style={{
      // Ortak genişlik değişkenlerini köke yazıyoruz
      ['--day-w']: `${dayColW}px`,
      ['--left-w']: `${leftColW}px`,
    }}>
      {/* Sticky Header (tam şerit, blur) */}
      <div className="sticky top-0 z-50 backdrop-blur-md bg-neutral-950/70 border-b border-neutral-800">
        <div className="mx-auto max-w-[1400px] px-3 sm:px-4 md:px-6 py-3 gap-3 flex items-center justify-between">
          <h1 className="text-lg sm:text-2xl font-semibold truncate pr-2">{title}</h1>

          {/* Masaüstü kontroller */}
          <div className="hidden md:flex items-center gap-2">
            <select
              className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i}>{monthNameTR(i)}</option>
              ))}
            </select>
            <input
              type="number"
              className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 w-[90px]"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />

            <button onClick={() => setShowSettings((s) => !s)} className="btn-ghost">Ayarlar</button>
            <button onClick={exportJSON} className="btn-ghost">Dışa aktar</button>
            <label className="btn-ghost cursor-pointer">
              İçe aktar
              <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJSON(e.target.files[0])} />
            </label>
            <button onClick={clearMonth} className="btn-ghost">Ayı temizle</button>

            <button onClick={handleCloudLoad} className="btn-ghost">Buluttan yükle</button>
            <button onClick={handleCloudSave} className="btn-primary">Buluta kaydet</button>

            <AuthPanel onSignIn={signInWithEmail} onSignOut={signOut} session={session} user={user} compact />
          </div>

          {/* Mobil Menü butonu */}
          <button
            className="md:hidden inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700"
            onClick={() => setDrawerOpen(true)}
            aria-label="Menü"
          >
            <span>Menü</span>
          </button>
        </div>

        {/* İstatistikler: mobil 2×2, md’de 4 sütun */}
        <div className="mx-auto max-w-[1400px] px-3 sm:px-4 md:px-6 pb-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Gün sayısı" value={dim} />
            <StatCard
              label="Ay ilerleme"
              value={`${Math.round((dailyScores.filter((x)=>x>0).length/dim)*100)}%`}
              progress={Math.round((dailyScores.filter((x)=>x>0).length/dim)*100)}
            />
            <StatCard
              label="Ortalama gün skoru"
              value={`${Math.round((dailyScores.reduce((a,b)=>a+b,0)/Math.max(1,dailyScores.length))*100)}%`}
              progress={Math.round((dailyScores.reduce((a,b)=>a+b,0)/Math.max(1,dailyScores.length))*100)}
            />
            <StatCard label="En uzun streak (≥%80)" value={longestStreak()} />
          </div>
        </div>

        {/* Günler başlığı (sticky) */}
        <div className="sticky top-0 z-40 border-t border-neutral-800 bg-neutral-950/80 backdrop-blur-md">
          <div className="mx-auto max-w-[1400px] px-3 sm:px-4 md:px-6 py-2 overflow-x-auto" ref={daysHeaderRef} style={{ WebkitOverflowScrolling: 'touch', willChange: 'scroll-position' }}>
            <div className="min-w-[900px] flex items-center" style={{ columnGap: '1.5rem' }}>
              {/* Sol başlık: genişliği ölçülen sol hücre ile aynı */}
              <div className="text-sm text-neutral-400 shrink-0" style={{ width: 'var(--left-w)' }}>Hedef</div>
              {/* Gün numaraları */}
              <div className="flex-1 flex items-center text-sm text-neutral-300" style={{ columnGap: '1.5rem' }}>
                <div className="flex items-center">
                  {Array.from({ length: dim }, (_, i) => (
                    <div key={i} className="text-center" style={{ width: 'var(--day-w)' }}>{i + 1}</div>
                  ))}
                </div>
                <div className="w-16 text-right">%Tamam</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sync status */}
      {syncInfo && (
        <div className="mx-auto max-w-[1400px] px-3 sm:px-4 md:px-6 pt-2 text-xs text-neutral-400">• {syncInfo}</div>
      )}

      {/* GRID */}
      <div className="mx-auto max-w-[1400px] px-3 sm:px-4 md:px-6 mt-2">
        <div className="w-full overflow-x-auto rounded-2xl border border-neutral-800">
          <div ref={bodyScrollRef} className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch', willChange: 'scroll-position' }}>
            <table className="w-full md:min-w-[1100px]">
              <tbody>
                {habits.map((h, idx) => (
                  <tr key={h.id} className="odd:bg-neutral-950 even:bg-neutral-900/40 border-t border-neutral-900">
                    {/* Sol Hedef Hücresi (sticky left) */}
                    <td className="px-3 py-2 align-top sticky left-0 z-10 bg-neutral-950" ref={idx===0?leftCellProbeRef:undefined} style={{ width: 'var(--left-w)' }}>
                      <div className="font-medium leading-tight text-base md:text-[15px]">{h.title}</div>
                      <div className="text-xs text-neutral-400 mt-0.5">
                        Birim: {UNIT_TYPES.find(u=>u.id===h.unit)?.label} · Hedef: {h.target}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => setEditingHabit(h)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-700 hover:bg-neutral-800">Düzenle</button>
                        <button onClick={() => removeHabit(h.id)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-red-700/70 text-red-300 hover:bg-red-900/20">Sil</button>
                      </div>
                    </td>

                    {/* Gün hücreleri */}
                    <td className="px-0 py-0">
                      <div className="flex items-center pr-4" style={{ columnGap: '1.5rem' }}>
                        {/* Günler */}
                        <div className="flex items-center">
                          {Array.from({ length: dim }, (_, i) => {
                            const day = i + 1;
                            const val = getCell(h.id, day);
                            const score = scoreFor(h, day);
                            const isToday = year === ty && month === tm && day === td;
                            return (
                              <div key={day} className="flex justify-center py-1" style={{ width: 'var(--day-w)' }}>
                                <button
                                  onClick={() => setCell(h.id, day, cycleValue(h, val))}
                                  onContextMenu={(e) => { e.preventDefault(); setCell(h.id, day, null); }}
                                  className={`w-9 h-9 md:h-8 rounded-lg border text-sm select-none touch-manipulation ${
                                    score >= 1 ? 'bg-green-600/30 border-green-600/60'
                                    : score > 0 ? 'bg-amber-600/20 border-amber-600/50'
                                    : 'bg-neutral-900 border-neutral-800'
                                  } ${isToday ? 'ring-2 ring-blue-500' : ''}`}
                                  title="Sol tık: artır / sağ tık: temizle"
                                  aria-label={`Gün ${day} değeri`}
                                >
                                  {h.unit === 'check' ? (val ? '✓' : '') : (val ?? '')}
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {/* %Tamam */}
                        <div className="w-16 text-right pr-1 text-sm">
                          {(() => {
                            let s = 0; for (let d = 1; d <= dim; d++) s += scoreFor(h, d);
                            const pct = Math.round((s / dim) * 100);
                            return <span className={pct>=80?'text-green-400':'text-neutral-300'}>{pct}%</span>;
                          })()}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="px-3 py-3" colSpan={2}>
                    <button onClick={addHabit} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600/20 border border-blue-500/40 hover:bg-blue-600/30">+ Yeni hedef ekle</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 text-sm text-neutral-400">
          İpucu: Hücreye dokununca değer artar, basılı tutma yok; sağ tık/uzun basış ile temizle. %80 ve üzeri günler streak sayılır.
        </div>
      </div>

      {/* Editör Modal */}
      {editingHabit && (
        <HabitEditor
          habit={editingHabit}
          onClose={() => setEditingHabit(null)}
          onSave={(updated) => {
            setHabits((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
            setEditingHabit(null);
          }}
        />
      )}

      {/* Ayarlar Modal */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {/* Mobil Drawer */}
      {drawerOpen && (
        <MobileControls
          onClose={() => setDrawerOpen(false)}
          month={month}
          setMonth={setMonth}
          year={year}
          setYear={setYear}
          onExport={exportJSON}
          onImport={importJSON}
          onClear={clearMonth}
          onLoad={handleCloudLoad}
          onSave={handleCloudSave}
          session={session}
          user={user}
          onSignIn={signInWithEmail}
          onSignOut={signOut}
          title={title}
          setTitle={setTitle}
        />
      )}
    </div>
  );
}

// -------------------- Alt Bileşenler --------------------
function StatCard({ label, value, progress }) {
  return (
    <div className="rounded-2xl bg-neutral-900 border border-neutral-800 p-4 min-w-0">
      <div className="text-neutral-400 text-xs sm:text-sm truncate">{label}</div>
      <div className="text-xl sm:text-2xl font-semibold mt-1">{value}</div>
      {typeof progress === 'number' && (
        <div className="mt-2 h-2 rounded-full bg-neutral-800 overflow-hidden">
          <div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
    </div>
  );
}

function HabitEditor({ habit, onClose, onSave }) {
  const [title, setTitle] = useState(habit.title);
  const [unit, setUnit] = useState(habit.unit);
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
          <p>• Hücreye <b>dokun</b> → artır; <b>sağ tık / uzun bas</b> → temizle.</p>
          <p>• Streak: Gün ortalaması ≥%80 olduğunda ardışık gün sayısı artar.</p>
        </div>
      </div>
    </div>
  );
}

function AuthPanel({ onSignIn, onSignOut, session, user, compact }) {
  const [email, setEmail] = useState('');
  if (session) {
    return (
      <div className={`flex items-center gap-2 ${compact ? 'text-sm' : ''}`}>
        <span className="text-sm text-neutral-300 truncate max-w-[200px]">{user?.email}</span>
        <span className="text-xs px-2 py-1 rounded-lg border border-green-600/50 text-green-300">Bulut: Kullanıcı</span>
        <button onClick={onSignOut} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 hover:bg-neutral-800">Çıkış</button>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 ${compact ? 'hidden md:flex' : ''}`}>
      <input
        value={email}
        onChange={(e)=>setEmail(e.target.value)}
        placeholder="email@ornek.com"
        className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2"
      />
      <span className="text-xs px-2 py-1 rounded-lg border border-neutral-600/50 text-neutral-300">Bulut: Cihaz</span>
      <button onClick={()=>email && onSignIn(email)} className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-500">Giriş linki gönder</button>
    </div>
  );
}

function MobileControls({
  onClose, month, setMonth, year, setYear,
  onExport, onImport, onClear, onLoad, onSave,
  session, user, onSignIn, onSignOut, title, setTitle
}) {
  const [email, setEmail] = useState('');
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-[92%] max-w-sm bg-neutral-950 border-l border-neutral-800 p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Menü</div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-200">Kapat</button>
        </div>

        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm text-neutral-300">Başlık</span>
            <input value={title} onChange={(e)=>setTitle(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2" />
          </label>

          <div className="flex gap-2">
            <select className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 flex-1" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i}>{monthNameTR(i)}</option>
              ))}
            </select>
            <input type="number" className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 w-28" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>

          <div className="flex gap-2">
            <button onClick={onLoad} className="btn-ghost flex-1">Buluttan yükle</button>
            <button onClick={onSave} className="btn-primary flex-1">Buluta kaydet</button>
          </div>

          <div className="flex gap-2">
            <button onClick={onExport} className="btn-ghost flex-1">Dışa aktar</button>
            <label className="btn-ghost flex-1 justify-center cursor-pointer">
              İçe aktar
              <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
            </label>
          </div>

          <button onClick={onClear} className="btn-ghost w-full">Ayı temizle</button>

          {/* Auth */}
          {session ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="text-sm text-neutral-300 truncate">{user?.email}</div>
              <button onClick={onSignOut} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 hover:bg-neutral-800">Çıkış</button>
            </div>
          ) : (
            <div className="mt-2 grid gap-2">
              <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="email@ornek.com" className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2" />
              <button onClick={()=>email && onSignIn(email)} className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-500">Giriş linki gönder</button>
              <div className="text-xs text-neutral-400">Bulut modu yoksa cihaz modunda çalışırsın.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -------- Küçük yardımcı buton stilleri --------
const btn = {
  ghost: 'inline-flex items-center gap-2 bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 hover:bg-neutral-800',
  primary: 'inline-flex items-center gap-2 bg-blue-600 text-white rounded-xl px-3 py-2 hover:bg-blue-500'
};
function Button({ variant='ghost', className='', ...rest }) {
  return <button className={`${btn[variant]} ${className}`} {...rest} />;
}

// Utility class alias: JSX içinde kullandık
const btnGhost = btn.ghost;
const btnPrimary = btn.primary;

// className sugar
function cls() {}

/* Not: Tailwind varsayılarak yazıldı. Ek olarak sticky başlık kayması yaşamamak için
   hem başlıkta hem gövdede ortak CSS değişkenleri kullanıyoruz:
   --left-w : Sol "Hedef" sütunu genişliği
   --day-w  : Gün sütunu genişliği (tüm günlerde sabit)
   - Üst başlık ve gövde yatay scrollda iki yönlü senkronize. */
