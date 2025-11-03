// src/App.jsx — Lifestyle Challenge (Rev: sticky+mobile drawer, manual cloud sync)

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';

// ========================= Helpers & Consts =========================
const UNIT_TYPES = [
  { id: 'check',   label: 'Checkbox' },
  { id: 'count',   label: 'Adet' },
  { id: 'minutes', label: 'Dakika' },
  { id: 'ml',      label: 'mL' },
  { id: 'grams',   label: 'Gram' },
];

function daysInMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); }
function monthNameTR(i) {
  return ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'][i];
}
function today() {
  const n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() };
}
function getDeviceId() {
  try {
    let id = localStorage.getItem('lc_device_id');
    if (!id) { id = crypto?.randomUUID?.() ?? ('dev-' + Math.random().toString(36).slice(2)); localStorage.setItem('lc_device_id', id); }
    return id;
  } catch { return 'dev-' + Math.random().toString(36).slice(2); }
}
const DEVICE_ID = getDeviceId();
const STORAGE_KEY = 'lifestyle_challenge_state_v2';

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

// ========================= Supabase I/O =========================
// device snapshots
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
    .eq('device_id', DEVICE_ID).eq('year', year).eq('month', month).maybeSingle();
  if (error) throw error;
  return row?.payload ?? null;
}

// user snapshots
async function saveUserSnapshot(userId, { year, month, habits, data, title }) {
  const { error } = await supabase.from('user_snapshots').upsert(
    { user_id: userId, year, month, payload: { year, month, habits, data, title } },
    { onConflict: 'user_id,year,month' }
  );
  if (error) throw error;
}
async function loadUserSnapshot(userId, year, month) {
  const { data: row, error } = await supabase
    .from('user_snapshots')
    .select('payload')
    .eq('user_id', userId).eq('year', year).eq('month', month).maybeSingle();
  if (error) throw error;
  return row?.payload ?? null;
}
async function migrateAllDeviceSnapshotsToUser(userId) {
  const { data: dev, error } = await supabase
    .from('snapshots')
    .select('year,month,payload')
    .eq('device_id', DEVICE_ID);
  if (error) throw error;
  if (!dev?.length) return 0;
  const up = dev.map(r => ({ user_id: userId, year: r.year, month: r.month, payload: r.payload }));
  const { error: upErr } = await supabase.from('user_snapshots').upsert(up, { onConflict: 'user_id,year,month' });
  if (upErr) throw upErr;
  return up.length;
}

// ========================= App =========================
export default function App() {
  const { y: TY, m: TM, d: TD } = today();

  // auth
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);

  // ui & data
  const [title, setTitle] = useState('Lifestyle Challenge');
  const [year, setYear] = useState(TY);
  const [month, setMonth] = useState(TM);
  const [habits, setHabits] = useState(DEFAULT_HABITS);
  const [data, setData] = useState({});
  const [syncInfo, setSyncInfo] = useState('');
  const [editingHabit, setEditingHabit] = useState(null);

  // mobile drawer
  const [drawerOpen, setDrawerOpen] = useState(false);

  // sticky sync (tek container)
  const scrollRef = useRef(null);

  const dim = daysInMonth(year, month);

  // ---------- Auth wiring ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data?.session ?? null);
      setUser(data?.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      setSession(sess ?? null); setUser(sess?.user ?? null);
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // oturum açınca cihaz kayıtlarını user'a taşı + mevcut ayı getir
  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      try {
        const moved = await migrateAllDeviceSnapshotsToUser(user.id);
        if (moved) setSyncInfo(`Cihazdan hesaba ${moved} kayıt taşındı`);
        const payload = await loadUserSnapshot(user.id, year, month);
        if (payload) hydrateFromPayload(payload);
      } catch (e) { console.error(e); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ---------- Local persistence ----------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p?.title) setTitle(p.title);
      if (p?.year) setYear(p.year);
      if (typeof p?.month === 'number') setMonth(p.month);
      if (Array.isArray(p?.habits)) setHabits(p.habits);
      if (p?.data) setData(p.data);
    } catch {}
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ title, year, month, habits, data }));
  }, [title, year, month, habits, data]);

  // ---------- Month/Year change → load user/device or clear ----------
  useEffect(() => {
    (async () => {
      const uid = user?.id;
      try {
        let payload = null;
        if (uid) payload = await loadUserSnapshot(uid, year, month);
        else payload = await loadDeviceSnapshot(year, month);
        if (payload) hydrateFromPayload(payload);
        else clearOnlyData(); // alışkanlıklar kalsın, bu ay boş
      } catch (e) {
        console.error(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, user?.id]);

  // ---------- helpers (state ops) ----------
  function hydrateFromPayload(payload) {
    setTitle(payload.title ?? 'Lifestyle Challenge');
    setHabits(Array.isArray(payload.habits) ? payload.habits : DEFAULT_HABITS);
    setData(payload.data ?? {});
  }
  function clearOnlyData() {
    setData({});
  }
  function getCell(hid, day) { return data?.[hid]?.[day] ?? null; }
  function setCell(hid, day, value) {
    setData(prev => ({ ...prev, [hid]: { ...(prev[hid] || {}), [day]: value } }));
  }
  function cycleValue(habit, current) {
    if (habit.unit === 'check')   return current ? 0 : 1;
    if (habit.unit === 'count')   return (Number(current) || 0) + 1;
    if (habit.unit === 'minutes') return (Number(current) || 0) + 5;
    if (habit.unit === 'ml')      return (Number(current) || 0) + 250;
    if (habit.unit === 'grams')   return (Number(current) || 0) + 10;
    return current;
  }
  function removeHabit(id) {
    if (!confirm('Bu hedefi silmek istiyor musun?')) return;
    setHabits(prev => prev.filter(h => h.id !== id));
    setData(prev => { const c = { ...prev }; delete c[id]; return c; });
  }
  function addHabit() {
    const base = { id: `habit_${Date.now()}`, title: 'Yeni hedef', unit: 'check', target: 1 };
    setHabits(h => [...h, base]); setEditingHabit(base);
  }

  function scoreFor(habit, day) {
    const v = getCell(habit.id, day);
    if (v == null) return 0;
    if (habit.unit === 'check') return v ? 1 : 0;
    if (['count','minutes','ml','grams'].includes(habit.unit)) {
      const t = Number(habit.target || 1); return Math.min(1, Number(v) / (t || 1));
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
      if (dailyScores[d - 1] >= 0.8) { cur += 1; best = Math.max(best, cur); } else cur = 0;
    }
    return best;
  }

  // ---------- Cloud ops (manual) ----------
  async function handleCloudSave() {
    try {
      const payload = { title, year, month, habits, data };
      if (user?.id) await saveUserSnapshot(user.id, payload);
      else          await saveDeviceSnapshot(payload);
      setSyncInfo('Buluta kaydedildi');
    } catch (e) { console.error(e); setSyncInfo('Buluta kaydedilemedi'); }
  }
  async function handleCloudLoad() {
    try {
      let payload = null;
      if (user?.id) payload = await loadUserSnapshot(user.id, year, month);
      else          payload = await loadDeviceSnapshot(year, month);
      if (!payload) { setSyncInfo('Kayıt bulunamadı'); return; }
      hydrateFromPayload(payload);
      setSyncInfo('Buluttan yüklendi');
    } catch (e) { console.error(e); setSyncInfo('Buluttan yüklenemedi'); }
  }

  // ---------- Auth ops ----------
  async function signInWithEmail(email) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) throw error;
    alert('Giriş linki e-postana gönderildi.');
  }
  async function signOut() { await supabase.auth.signOut(); }

  // ========================= Render =========================
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      {/* Sticky Header (blur) */}
      <div className="sticky top-0 z-40 backdrop-blur-md bg-neutral-950/70 border-b border-neutral-900">
        <div className="mx-auto max-w-[1400px] px-3 sm:px-4 py-3">
          <HeaderBar
            title={title}
            setTitle={setTitle}
            year={year}
            month={month}
            setYear={setYear}
            setMonth={setMonth}
            session={session}
            user={user}
            onSignOut={signOut}
            onOpenDrawer={() => setDrawerOpen(true)}
            onCloudLoad={handleCloudLoad}
            onCloudSave={handleCloudSave}
            isMobile={isMobile}
          />
        </div>

        {/* Sticky Metrics + Day header (tek scroll container ile hizalı) */}
        <div className="mx-auto max-w-[1400px] px-3 sm:px-4 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <StatCard label="Gün sayısı" value={dim} />
            <StatCard label="Ay ilerleme" value={
              <Progress value={Math.round((dailyScores.filter(x=>x>0).length/dim)*100)} />
            } />
            <StatCard label="Ortalama gün skoru" value={
              <Progress value={Math.round((dailyScores.reduce((a,b)=>a+b,0)/Math.max(1,dailyScores.length))*100)} />
            } />
            <StatCard label="En uzun streak (≥%80)" value={longestStreak()} />
          </div>

          {/* Gün başlığı row (sticky altında) */}
          <div className="mt-3 overflow-hidden rounded-2xl border border-neutral-800">
            <div className="bg-neutral-900">
              <div className="grid grid-cols-[320px_1fr_80px]">
                {/* sticky ilk kolon başlığı */}
                <div className="px-3 py-2 text-sm text-neutral-300 sticky left-0 z-20 bg-neutral-900">Hedef</div>
                {/* günler */}
                <div className="overflow-x-hidden">
                  <div className="flex">
                    {Array.from({ length: dim }, (_, i) => (
                      <div key={i} className="w-10 text-center px-1 py-2 text-xs text-neutral-300">{i+1}</div>
                    ))}
                  </div>
                </div>
                <div className="px-2 py-2 text-center text-xs text-neutral-300">%Tamam</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Body: grid satırları (başlıkla aynı genişlik, tek scroll) */}
      <div className="mx-auto max-w-[1400px] px-3 sm:px-4 pb-10">
        {syncInfo && <div className="text-xs text-neutral-400 mt-3">{syncInfo}</div>}

        <div
          ref={scrollRef}
          className="mt-2 overflow-x-auto rounded-2xl border border-neutral-800"
        >
          <div className="min-w-[900px]">
            {habits.map((h) => (
              <HabitRow
                key={h.id}
                habit={h}
                dim={dim}
                ty={TY} tm={TM} td={TD}
                getCell={getCell}
                setCell={setCell}
                scoreFor={scoreFor}
                onEdit={()=>setEditingHabit(h)}
                onRemove={()=>removeHabit(h.id)}
              />
            ))}

            <div className="px-3 py-4">
              <button
                onClick={addHabit}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600/20 border border-blue-500/40 hover:bg-blue-600/30 transition"
              >
                + Yeni hedef ekle
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 text-sm text-neutral-400">
          İpucu: Hücreye tıklayınca değer artar, sağ tıkla temizlenir. %80 ve üzeri günler streak sayılır.
        </div>
      </div>

      {/* Drawer (mobil) */}
      <Drawer open={drawerOpen} onClose={()=>setDrawerOpen(false)}>
        <MobileControls
          year={year} month={month}
          setYear={setYear} setMonth={setMonth}
          onCloudLoad={handleCloudLoad}
          onCloudSave={handleCloudSave}
          session={session} user={user}
          onSignIn={signInWithEmail}
          onSignOut={signOut}
          title={title} setTitle={setTitle}
        />
      </Drawer>

      {/* Modals */}
      {editingHabit && (
        <HabitEditor
          habit={editingHabit}
          onClose={()=>setEditingHabit(null)}
          onSave={(upd)=>{ setHabits(prev=>prev.map(x=>x.id===upd.id?upd:x)); setEditingHabit(null); }}
        />
      )}
    </div>
  );
}

// ========================= Components =========================
function HeaderBar({
  title, setTitle, year, month, setYear, setMonth,
  session, user, onSignOut, onOpenDrawer, onCloudLoad, onCloudSave, isMobile
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="bg-transparent text-xl sm:text-2xl font-semibold outline-none border-b border-neutral-800 focus:border-neutral-400 flex-1 min-w-0"
        value={title}
        onChange={e=>setTitle(e.target.value)}
      />

      {/* Desktop controls */}
      <div className="hidden md:flex items-center gap-2">
        <select
          className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2"
          value={month} onChange={e=>setMonth(Number(e.target.value))}
        >
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{monthNameTR(i)}</option>)}
        </select>
        <input
          type="number"
          className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 w-24"
          value={year} onChange={e=>setYear(Number(e.target.value))}
        />
        <button onClick={onCloudLoad} className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 hover:bg-neutral-800">Buluttan yükle</button>
        <button onClick={onCloudSave} className="bg-blue-600 text-white rounded-xl px-3 py-2 hover:bg-blue-500">Buluta kaydet</button>

        {session ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-300">{user?.email}</span>
            <span className="text-xs px-2 py-1 rounded-lg border border-green-600/50 text-green-300">Bulut: Kullanıcı</span>
            <button onClick={onSignOut} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 hover:bg-neutral-800">Çıkış</button>
          </div>
        ) : (
          <span className="text-xs px-2 py-1 rounded-lg border border-neutral-600/50 text-neutral-300">Bulut: Cihaz</span>
        )}
      </div>

      {/* Mobile: open drawer */}
      <button
        onClick={onOpenDrawer}
        className="md:hidden inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-800"
        aria-label="Menüyü aç"
      >
        ☰ Menü
      </button>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-2xl bg-neutral-900 border border-neutral-800 p-4">
      <div className="text-neutral-400 text-sm">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function Progress({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span>{v}%</span>
        <button
          className="text-xs px-2 py-0.5 rounded-lg border border-neutral-700 hover:bg-neutral-800"
          title="Sıfırla"
          onClick={(e)=>{ e.preventDefault(); /* sadece görsel */ }}
        >
          Başla
        </button>
      </div>
      <div className="h-2 rounded-full bg-neutral-800">
        <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function HabitRow({ habit, dim, ty, tm, td, getCell, setCell, scoreFor, onEdit, onRemove }) {
  return (
    <div className="grid grid-cols-[320px_1fr_80px] odd:bg-neutral-950 even:bg-neutral-900/40 border-t border-neutral-900">
      {/* sticky first col */}
      <div className="px-3 py-2 sticky left-0 z-10 bg-neutral-950">
        <div className="font-medium leading-tight">{habit.title}</div>
        <div className="text-xs text-neutral-400">
          Birim: {UNIT_TYPES.find(u=>u.id===habit.unit)?.label} · Hedef: {habit.target}
        </div>
        <div className="mt-1 flex gap-2">
          <button onClick={onEdit} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-700 hover:bg-neutral-800">Düzenle</button>
          <button onClick={onRemove} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-red-700/70 text-red-300 hover:bg-red-900/20">Sil</button>
        </div>
      </div>

      {/* cells */}
      <div className="overflow-x-hidden px-1 py-1">
        <div className="flex">
          {Array.from({ length: dim }, (_, i) => {
            const day = i + 1;
            const val = getCell(habit.id, day);
            const score = scoreFor(habit, day);
            const isToday = ty && tm && td && (day===td);
            return (
              <button
                key={day}
                onClick={() => setCell(habit.id, day, cycleValue(habit, val))}
                onContextMenu={(e)=>{ e.preventDefault(); setCell(habit.id, day, null); }}
                className={`w-10 h-8 m-0.5 rounded-lg border text-sm select-none transition
                ${score >= 1 ? 'bg-green-600/30 border-green-600/60'
                  : score > 0 ? 'bg-amber-600/20 border-amber-600/50'
                  : 'bg-neutral-900 border-neutral-800'}
                ${isToday ? 'ring-2 ring-blue-500' : ''}`}
                title="Sol tık: artır · Sağ tık: temizle"
              >
                {habit.unit === 'check' ? (val ? '✓' : '') : (val ?? '')}
              </button>
            );
          })}
        </div>
      </div>

      {/* % */}
      <div className="px-2 py-1 text-center text-sm flex items-center justify-center">
        {(() => {
          let s = 0; for (let d = 1; d <= dim; d++) s += scoreFor(habit, d);
          const pct = Math.round((s / dim) * 100);
          return <span className={pct>=80?'text-green-400':'text-neutral-300'}>{pct}%</span>;
        })()}
      </div>
    </div>
  );
}

function HabitEditor({ habit, onClose, onSave }) {
  const [title, setTitle]   = useState(habit.title);
  const [unit, setUnit]     = useState(habit.unit);
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

function Drawer({ open, onClose, children }) {
  return (
    <div className={`fixed inset-0 z-50 transition ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div className={`absolute right-0 top-0 h-full w-[92%] max-w-[420px] bg-neutral-950 border-l border-neutral-800 p-4 transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Menü</div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-200">Kapat</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MobileControls({
  year, month, setYear, setMonth,
  onCloudLoad, onCloudSave,
  session, user, onSignIn, onSignOut,
  title, setTitle
}) {
  const [email, setEmail] = useState('');
  return (
    <div className="space-y-4">
      <label className="grid gap-1">
        <span className="text-sm text-neutral-300">Başlık</span>
        <input value={title} onChange={e=>setTitle(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2"/>
      </label>

      <div className="flex gap-2">
        <select
          className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 w-full"
          value={month} onChange={e=>setMonth(Number(e.target.value))}
        >
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{monthNameTR(i)}</option>)}
        </select>
        <input
          type="number"
          className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 w-32"
          value={year} onChange={e=>setYear(Number(e.target.value))}
        />
      </div>

      <div className="flex gap-2">
        <button onClick={onCloudLoad} className="flex-1 bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 hover:bg-neutral-800">Buluttan yükle</button>
        <button onClick={onCloudSave} className="flex-1 bg-blue-600 text-white rounded-xl px-3 py-2 hover:bg-blue-500">Buluta kaydet</button>
      </div>

      {session ? (
        <div className="flex items-center justify-between gap-2 border border-neutral-800 rounded-xl p-3">
          <div>
            <div className="text-sm">{user?.email}</div>
            <div className="text-xs text-green-300 mt-0.5">Bulut: Kullanıcı</div>
          </div>
          <button onClick={onSignOut} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 hover:bg-neutral-800">Çıkış</button>
        </div>
      ) : (
        <div className="grid gap-2">
          <label className="grid gap-1">
            <span className="text-sm text-neutral-300">E-posta ile giriş</span>
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@ornek.com" className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2"/>
          </label>
          <div className="flex items-center justify-between">
            <span className="text-xs px-2 py-1 rounded-lg border border-neutral-600/50 text-neutral-300">Bulut: Cihaz</span>
            <button
              onClick={()=>email && onSignIn(email)}
              className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-500"
            >
              Giriş linki gönder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
