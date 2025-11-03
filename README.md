# Lifestyle Challenge

Kışisel alışkanlıklarını ay bazında takip et: günlük hedefler, tek tıkla işaretleme, ilerleme ve streak istatistikleri.
Oturum açmadan **cihaz bazlı** çalışır; e-posta ile giriş yaptıktan sonra verilerin **Supabase**'te hesabınla eşleşir.

> Ekran görüntüsü / GIF ekleyin: `docs/screenshot.png`

---

## ✨ Özellikler

* **Ay takvimi grid**: Checkbox / adet / dakika / ml / gram destekli hücreler
* **Sticky üst bar**: istatistik kartları + gün başlıkları her daim görünür (blur efektli)
* **Cihaz ve kullanıcı senkronu**

  * Oturum yoksa: cihaz kimliği ile `snapshots`
  * Oturum varsa: kullanıcı kimliği ile `user_snapshots`
* **JSON içe/dışa aktarım** (offline yedek)
* **Mobil uyumlu**, dokunma dostu hücreler
* **Supabase Magic Link (şifresiz login)**

---

## 🧱 Teknoloji Yığını

* **Vite + React**
* **Tailwind CSS** (utility-first)
* **Supabase JS** (Auth + Postgres)
* **Cloudflare Pages** / **Vercel** (deploy için)

---

## 📁 Klasör Yapısı

```
.
├── public/
│   └── _redirects           # SPA yönlendirmesi (Cloudflare Pages)
├── src/
│   ├── App.jsx              # Uygulama
│   ├── index.html
│   ├── index.css
│   └── lib/
│       └── supabase.js      # Supabase client (ENV değişkenlerini okur)
├── .env                     # (lokalde) VITE_SUPABASE_URL/ANON_KEY
├── vite.config.js
└── package.json
```

---

## ⚙️ Kurulum

```bash
# 1) Bağımlılıklar
npm ci

# 2) .env oluştur
cp .env.example .env
# .env içini doldur (aşağıya bak)

# 3) Geliştirme
npm run dev

# 4) Build
npm run build
npm run preview
```

**.env.example**

```bash
VITE_SUPABASE_URL=https://<proje-id>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

> Üretimde (Pages/Vercel) bu değişkenleri **Environment Variables** olarak tanımlayın; `.env` dosyasını repoya push’lamayın.

---

## 💃 Veritabanı Şeması (Supabase)

**snapshots** – cihaz bazlı

```sql
create table if not exists public.snapshots (
  id         bigint generated always as identity primary key,
  device_id  text not null,
  year       int not null,
  month      int not null,           -- 0-11
  payload    jsonb not null,         -- {year, month, habits, data, title}
  updated_at timestamptz default now(),
  unique (device_id, year, month)
);
```

**user_snapshots** – kullanıcı bazlı

```sql
create table if not exists public.user_snapshots (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,          -- auth.users.id
  year       int not null,
  month      int not null,           -- 0-11
  payload    jsonb not null,         -- {year, month, habits, data, title}
  updated_at timestamptz default now(),
  unique (user_id, year, month)
);
```

> RLS kapalı (Public) senaryoda ek politika gerekmiyor. RLS açacaksanız `auth.uid()` bazlı `select/insert/upsert` politikaları tanımlayın.

---

## 🔐 Auth & Redirect’ler

**Supabase → Authentication → URL Configuration**

* **Site URL**: yayındaki domain (örn. `https://app.pages.dev` veya `https://example.com`)
* **Additional Redirect URLs**: aynı adres(ler)
* **CORS origins**: aynı adres(ler)

Uygulama magic-link dönüşünü `window.location.origin` ile işler; prod domaininizi mutlaka ekleyin.

---

## 🚀 Yayınlama

### Cloudflare Pages (en önerilen)

* Framework preset: **Vite**
* Build command: `npm ci && npm run build`
* Output directory: `dist`
* Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
* SPA yönlendirmesi için `public/_redirects`:

  ```
  /* /index.html 200
  ```

### Vercel (alternatif)

* Build: `npm run build`
* Output: `dist`
* (Opsiyonel) `vercel.json` SPA fallback

  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```

### Üretsiz custom alt-alan (opsiyon)

* **is-a.dev** / **js.org** üzerinden `CNAME` ile Pages/Vercel’e yönlendirin.

---

## 🧪 Geliştirme Notları

* **Autosave yok**: Kullanıcı **Buluta kaydet** ile yazar; **Buluttan yükle** ile okur.
* Ay/yıl değişince uygulama ilgili snapshot’ı **çekip, yoksa boş state** ile başlatır.
* Sticky üst bar (istatistikler) ve gün başlığı scrolle sabit; grid ile yatay scroll senkronize.

---

## 🦯 Yol Haritası

* [ ] Çoklu profil / hedef preset’leri
* [ ] Haftalık görünüm
* [ ] CSV/Sheets dışa aktarma
* [ ] RLS politikaları ve kullanıcıya özel erişim (prod)

---

## 🔧 Komutlar

```bash
npm run dev       # local geliştirme
npm run build     # üretim derlemesi
npm run preview   # yerel önizleme (dist)
```

---

## 🤝 Katkı

PR ve issue’lar memnuniyetle. UI/UX, erişilebilirlik ve mobil deneyim önerileri özellikle değerli.

---

## 📄 Lisans

MIT
