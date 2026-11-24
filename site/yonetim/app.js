/* IstanbulPrintLab Yönetim — telefondan fotoğraf yönetimi.
   Akış: Fotoğraf ekle → nereye → açıklama → hazır; değişiklikler telefonda birikir; tek "Yayınla" = tek commit = tek yayın.
   Güvenlik: GitHub anahtarı tarayıcıya hiç gelmez; tüm istekler sitenin kendi aracısından (/.netlify/functions/gh) geçer.
   Bütünlük: bir değişiklik bile uygulanamıyorsa hiçbir şey yayınlanmaz; sonucu belirsiz yayın, doğrulanmadan tekrarlanmaz.
   Kalıcı silme yok: "Sayfadan kaldır" fotoğrafı sayfadan çıkarır, dosya arşivde kalır. */
(() => {
'use strict';

const REPO = 'karanerdogan34/istanbulprintlab-site';
const DAL = 'main';
const SITE = 'https://www.istanbulprintlab.com';
const ARACI = '/.netlify/functions/gh';
const UZUN_KENAR = 2000;
const EN_FAZLA_SECIM = 8;            // pilot güvenlik sınırı (iPhone belleği)
const EN_BUYUK_DOSYA = 40 * 1024 * 1024;

// ---------- küçük yardımcılar ----------
const $ = (s, k = document) => k.querySelector(s);
const kok = $('#uygulama');
const kacir = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
function bildir(m, sure = 2600) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t);
  setTimeout(() => t.remove(), sure);
}
function slug(s) {
  return String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'foto';
}
function blobB64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
}
// Yalnızca sitenin kendi sayfa yolları bağlantı olabilir.
const siteYolu = (y) => (/^\/[A-Za-z0-9._~\/-]*$/.test(y || '') ? SITE + y : SITE + '/');

// ---------- kalıcı taslak (IndexedDB) ----------
const DB = (() => {
  let db;
  const ac = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
    const r = indexedDB.open('ipl-yonetim', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('dosya'); };
    r.onsuccess = () => { db = r.result; res(db); }; r.onerror = () => rej(r.error);
  });
  // f(depolar) içinde yapılan tüm yazmalar tek işlemdir: ya hepsi kaydedilir ya hiçbiri.
  const islem = (depolar, mod, f) => ac().then((d) => new Promise((res, rej) => {
    const t = d.transaction(depolar, mod);
    const S = Object.fromEntries([].concat(depolar).map((n) => [n, t.objectStore(n)]));
    const istek = f(S);
    t.oncomplete = () => res(istek ? istek.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Kayıt iptal edildi'));
  }));
  return {
    al: (depo, k) => islem(depo, 'readonly', (S) => S[depo].get(k)),
    toplu: (f) => islem(['kv', 'dosya'], 'readwrite', f),
  };
})();

// ---------- durum ----------
const D = {
  giris: null,          // null: bilinmiyor, false: giriş gerekli, true: giriş yapılmış
  albumler: [],         // {id, tur, ad, yol, alan, klasor, sayfa, oid, veri}
  islemler: [],         // bekleyen değişiklikler (taslak)
  onizleme: {},         // yerel fotoğraf yolu → blob URL
  sonYayin: null,       // {sha, zaman, durum}
  ekran: { ad: 'ana' },
  ara: '',
  sonKullanilan: [],
  kayitHatasi: false,   // taslak telefona kaydedilemiyorsa yeni değişiklik alınmaz
};

async function gh(yol, yontem = 'GET', govde) {
  let r;
  try {
    r = await fetch(ARACI, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Yonetim': '1' }, body: JSON.stringify({ yol, yontem, govde }) });
  } catch (_) { throw Object.assign(new Error('İnternet bağlantısı yok ya da zayıf.'), { ag: true }); }
  if (r.status === 401) { D.giris = false; throw Object.assign(new Error('Oturumun süresi doldu. Değişiklikleriniz telefonda duruyor; tekrar giriş yapın.'), { oturum: true }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || ('Sunucu hatası ' + r.status)), { durum: r.status });
  return j;
}

// ---------- içerik okuma ----------
// Önce dalın son kaydı alınır; içerik o sabit kayıttan okunur (tutarlı anlık görüntü).
async function dalSha() { return (await gh(`/repos/${REPO}/git/ref/heads/${DAL}`)).object.sha; }
async function icerikOku(sha) {
  sha = sha || await dalSha();
  const j = await gh('/icerik', 'POST', { sha }); // sorguyu sunucu kurar
  if (j.errors) throw new Error(j.errors[0].message);
  const r = j.data.repository;
  const dosyalar = { 'content/projeler.json': { text: r.p.text, oid: r.p.oid } };
  if (r.a) dosyalar['content/anasayfa.json'] = { text: r.a.text, oid: r.a.oid };
  if (r.f) dosyalar['content/fiyatlar.json'] = { text: r.f.text, oid: r.f.oid };
  if (r.sf) dosyalar['siparis/src/fiyatlar.json'] = { text: r.sf.text, oid: r.sf.oid };
  if (r.i) dosyalar['content/iletisim.json'] = { text: r.i.text, oid: r.i.oid };
  dosyalar._htmlListe = { hi: r.hi && r.hi.entries, hr: r.hr && r.hr.entries };
  for (const e of (r.s?.entries || [])) if (e.name.endsWith('.json')) dosyalar['content/sayfalar/' + e.name] = e.object;
  for (const e of (r.v?.entries || [])) if (e.name.endsWith('.json')) dosyalar['content/vakalar/' + e.name] = e.object;
  for (const e of (r.g?.entries || [])) if (e.name.endsWith('.json')) dosyalar['content/galeri/' + e.name] = e.object;
  return { sha, dosyalar };
}

function albumleriKur(dosyalar) {
  const A = [];
  const an = dosyalar['content/anasayfa.json'];
  if (an) A.push({ id: 'anasayfa', tur: 'anasayfa', ad: 'Anasayfa yazıları', aciklama: 'Anasayfa metinleri, dönemsel kutular ve Google görünümü', yol: 'content/anasayfa.json', alan: null, sayfa: '/', oid: an.oid, veri: JSON.parse(an.text) });
  const fy = dosyalar['content/fiyatlar.json'];
  const sfy = dosyalar['siparis/src/fiyatlar.json'];
  if (sfy) A.push({ id: 'siparisFiyat', tur: 'fiyatlar', ad: 'Sipariş fiyatları (15 düğme)', aciklama: 'Hesaplayıcılardaki bütün fiyatlar · anasayfa düğmeleri ve sayfa metinleri birlikte değişir', yol: 'siparis/src/fiyatlar.json', alan: null, sayfa: '/', oid: sfy.oid, veri: JSON.parse(sfy.text) });
  if (fy) A.push({ id: 'fiyatlar', tur: 'fiyatlar', ad: 'Diğer fiyatlar', aciklama: 'Roll-up, takvim, cam filmi, dekupe · toplu zam / indirim', yol: 'content/fiyatlar.json', alan: null, sayfa: '/', oid: fy.oid, veri: JSON.parse(fy.text) });
  const il = dosyalar['content/iletisim.json'];
  if (il) A.push({ id: 'iletisim', tur: 'iletisim', ad: 'İletişim bilgileri', aciklama: 'Telefon, e-posta, adres — bütün sayfalarda', yol: 'content/iletisim.json', alan: null, sayfa: '/', oid: il.oid, veri: JSON.parse(il.text) });
  if (dosyalar._htmlListe) A.push(...htmlAlbumleri(dosyalar._htmlListe.hi, dosyalar._htmlListe.hr));
  const pj = dosyalar['content/projeler.json'];
  A.push({ id: 'projeler', tur: 'projeler', ad: 'Yaptığımız İşler', aciklama: 'Anasayfadaki proje kartları', yol: 'content/projeler.json', alan: 'projeler', klasor: 'projeler', sayfa: '/', oid: pj.oid, veri: JSON.parse(pj.text) });
  const gal = Object.entries(dosyalar).filter(([y]) => y.startsWith('content/galeri/')).map(([yol, d]) => [yol, d, JSON.parse(d.text)]).sort((a, b) => (a[2].sira || 999) - (b[2].sira || 999));
  for (const [yol, d, v] of gal) A.push({ id: yol, tur: 'galeri', ad: v.baslik || yol, aciklama: 'Projelerimiz kategorisi · anasayfa ve /galeri/', yol, alan: 'isler', klasor: 'galeri', sayfa: '/galeri/' + (v.slug || '') + '/', oid: d.oid, veri: v });
  for (const [yol, d] of Object.entries(dosyalar)) {
    if (yol.startsWith('_') || !yol.startsWith('content/vakalar/')) continue;
    const v = JSON.parse(d.text);
    A.push({ id: yol, tur: 'vaka', ad: v.firma || v.baslik || yol, aciklama: 'Vaka çalışması', yol, alan: 'kareler', klasor: 'vakalar', sayfa: '/projeler/' + (v.slug || '') + '/', oid: d.oid, veri: v });
  }
  // Henüz yayınlanmamış yeni vaka çalışmaları (taslakta) da sayfa olarak görünür.
  for (const i of D.islemler) if (i.tur === 'yeniVaka' && !A.some((a) => a.id === i.album)) {
    A.push({ id: i.album, tur: 'vaka', yeni: true, ad: i.veri.firma, aciklama: 'Yeni vaka çalışması — henüz sitede değil', yol: i.album, alan: 'kareler', klasor: 'vakalar', sayfa: '/projeler/' + i.veri.slug + '/', oid: null, veri: JSON.parse(JSON.stringify(i.veri)) });
  }
  for (const [yol, d] of Object.entries(dosyalar)) {
    if (!yol.startsWith('content/sayfalar/')) continue;
    const v = JSON.parse(d.text);
    const en = /^en\//.test(v.yol || '');
    A.push({ id: yol, tur: 'sayfa', en, ad: v.baslik || yol, aciklama: en ? 'Ürün sayfası (İngilizce)' : 'Ürün sayfası', yol, alan: 'fotolar', klasor: 'urunler', sayfa: '/' + (v.yol || '') + '/', oid: d.oid, veri: v });
  }
  return A;
}

function liste(al) { if (!al.alan) return []; const v = al.veri[al.alan]; return Array.isArray(v) ? v : (al.veri[al.alan] = []); }

// ---------- bekleyen değişiklikleri uygulama ----------
// İşlemler fotoğraf yoluna (gorsel) göre tanımlanır. Yayında en güncel içeriğe yeniden uygulanır;
// "siki" modda uygulanamayan tek bir işlem bile tüm yayını durdurur.
function islemUygula(al, i, siki) {
  if (i.tur === 'html') return htmlUygula(al, i, siki);
  if (i.tur === 'alan' || i.tur === 'liste') {
    const mevcut = yolAl(al.veri, i.yol);
    if (siki) {
      if (!esit(mevcut, i.eski)) throw Object.assign(new Error('Bu bölüm siz düzenlerken başka yerden değiştirilmiş.'), { islem: i, cakisma: true, mevcut });
      const hata = korumaHatasi(i.eski, i.yeni);
      if (hata) throw Object.assign(new Error(hata), { islem: i });
    }
    yolKoy(al.veri, i.yol, JSON.parse(JSON.stringify(i.yeni)));
    return;
  }
  if (i.tur === 'yeniVaka') {
    if (al.oid) { if (siki) throw Object.assign(new Error('Bu sayfa adresinde zaten bir vaka çalışması var. Yeni vakayı iptal edip başka adresle oluşturun.'), { islem: i }); return; }
    if (siki && (!i.veri.firma || !i.veri.baslik || !i.veri.kapak || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(i.veri.slug))) throw Object.assign(new Error('Yeni vaka çalışmasının firma adı, başlığı, adresi ve kapak fotoğrafı zorunludur.'), { islem: i });
    al.veri = kopya(i.veri); return;
  }
  const L = liste(al);
  const bul = () => L.findIndex((x) => x.gorsel === i.gorsel);
  const olmadi = (neden) => { if (siki) throw Object.assign(new Error(neden), { islem: i }); };
  if (i.tur === 'ekle') {
    if (bul() >= 0) return olmadi('Aynı fotoğraf zaten sayfada.');
    const yeni = al.tur === 'projeler'
      ? { baslik: i.baslik || '', etiket: '', aciklama: i.kisa || '', gorsel: i.gorsel, alt: i.alt || '', baglanti: '' }
      : { gorsel: i.gorsel, aciklama: i.aciklama || '' };
    if (al.tur === 'projeler') L.unshift(yeni); else L.push(yeni);
    return;
  }
  const n = bul();
  if (n < 0) return olmadi('Fotoğraf bu arada başka yerden kaldırılmış.');
  const x = L[n];
  if (i.tur === 'duzenle') {
    if (al.tur === 'projeler') {
      x.baslik = i.baslik; x.aciklama = i.kisa; x.alt = [i.baslik, i.kisa].filter(Boolean).join(' — ');
      if (i.etiket !== undefined) x.etiket = i.etiket;
      if (i.baglanti !== undefined) {
        // Yalnızca boş (teklif formu) ya da sitedeki bir vaka sayfası adresi kabul edilir.
        const gecerli = !i.baglanti || (/^\/projeler\/[a-z0-9-]+\/$/.test(i.baglanti) && (!siki || !GECERLI_VAKALAR || GECERLI_VAKALAR.has(i.baglanti)));
        if (!gecerli) { if (siki) throw Object.assign(new Error('Kartın bağlandığı vaka sayfası sitede bulunamadı.'), { islem: i }); }
        else x.baglanti = i.baglanti;
      }
    }
    else x.aciklama = i.aciklama;
  } else if (i.tur === 'basa') { L.splice(n, 1); L.unshift(x); }
  else if (i.tur === 'tasi') { const m = Math.max(0, Math.min(L.length - 1, n + i.yon)); L.splice(n, 1); L.splice(m, 0, x); }
  else if (i.tur === 'gizle' && al.tur === 'projeler') { if (i.deger) x.gizle = true; else delete x.gizle; }
  else if (i.tur === 'kaldir') { L.splice(n, 1); }
  else if (i.tur === 'kapak' && al.tur === 'vaka') { al.veri.kapak = x.gorsel; al.veri.kapak_aciklama = x.aciklama || al.veri.kapak_aciklama || ''; }
}

function gorunenAlbum(al) {
  if (!al.veri) return al; // henüz açılmamış HTML sayfası
  const kopya = { ...al, veri: JSON.parse(JSON.stringify(al.veri)) };
  for (const i of D.islemler) if (i.album === al.id) islemUygula(kopya, i, false);
  return kopya;
}
const bekleyenSayisi = (alId) => D.islemler.filter((i) => !alId || i.album === alId).length;

// Taslak + dosyalar tek seferde kaydedilir. Kaydedilemezse hata fırlatır; çağıran kullanıcıya açıkça söyler.
async function taslakYaz(yeniIslemler, { dosyaEkle = [], dosyaSil = [], dosyaTemizle = false } = {}) {
  try {
    await DB.toplu((S) => {
      if (dosyaTemizle) S.dosya.clear();
      for (const k of dosyaSil) S.dosya.delete(k);
      for (const [k, b] of dosyaEkle) S.dosya.put(b, k);
      S.kv.put(yeniIslemler, 'islemler');
      S.kv.put(D.sonKullanilan, 'sonKullanilan');
    });
    D.islemler = yeniIslemler; D.kayitHatasi = false;
  } catch (e) {
    D.kayitHatasi = true;
    throw new Error('Değişiklik telefona kaydedilemedi (telefon hafızası dolu olabilir). Bu değişiklik alınmadı.');
  }
}

const resimAdresi = (g) => D.onizleme[g] || SITE + g;

// ---------- fotoğraf küçültme (telefonda, sırayla) ----------
async function kucult(dosya) {
  if (dosya.size > EN_BUYUK_DOSYA) throw new Error('Dosya çok büyük (40 MB üstü).');
  const url = URL.createObjectURL(dosya);
  const img = new Image(); img.decoding = 'async';
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Bu fotoğraf açılamadı (desteklenmeyen biçim).')); img.src = url; });
    if (!img.naturalWidth) throw new Error('Bu fotoğraf okunamadı.');
    const o = Math.min(1, UZUN_KENAR / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * o), h = Math.round(img.naturalHeight * o);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h); // tarayıcı fotoğrafın yön bilgisini uygular; konum vb. bilgiler yeni dosyaya yazılmaz
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.84));
    c.width = c.height = 0;
    if (!blob || blob.size < 1000) throw new Error('Fotoğraf hazırlanamadı.');
    return { blob, w, h };
  } finally { img.src = ''; URL.revokeObjectURL(url); }
}

// ---------- ekranlar ----------
function ciz() {
  if (D.giris === false) return girisEkrani();
  if (!D.albumler.length) return yukleniyorEkrani();
  if (D.ekran.ad === 'album' && D.ekran.id === 'fiyatlar') return fiyatlarEkrani();
  if (D.ekran.ad === 'album' && D.ekran.id === 'siparisFiyat') return siparisFiyatEkrani();
  if (D.ekran.ad === 'album' && String(D.ekran.id).startsWith('html:')) { const a = D.albumler.find((x) => x.id === D.ekran.id); if (a) return htmlEkrani(a); }
  if (D.ekran.ad === 'album') return albumEkrani(D.ekran.id);
  return anaEkran();
}

function girisEkrani() {
  const n = bekleyenSayisi();
  kok.innerHTML = `<div class="giris">
    <h1>IstanbulPrintLab</h1><p>Site yönetimi</p>
    ${D.girisHatasi ? `<div class="hata-kutu">${kacir(D.girisHatasi)}</div>` : ''}
    ${n ? `<div class="uyari">${n} değişikliğiniz telefonda duruyor; giriş yapınca kaldığınız yerden devam edersiniz.</div>` : ''}
    <a class="buyuk-ekle" href="/.netlify/functions/giris">Giriş yap</a>
    <p class="kucuk-not">Bir kez giriş yapmanız yeterli; bu telefon sizi 30 gün hatırlar.</p>
  </div>`;
}
function yukleniyorEkrani(m) {
  kok.innerHTML = `<div class="ust"><h1>IstanbulPrintLab</h1></div><div class="aciklama-not">${kacir(m || 'Siteniz yükleniyor…')}</div>`;
}

function durumSatiri() {
  if (D.kayitHatasi) return `<div class="durum hata">Telefon hafızasına kayıt yapılamıyor. Yeni değişiklik eklemeden önce bekleyenleri yayınlayın.</div>`;
  const y = D.sonYayin;
  if (y && y.durum === 'belirsiz') return `<div class="durum bekle">Son yayının sonucu doğrulanamadı; internet gelince otomatik kontrol edilecek. Değişiklikleriniz telefonda güvende.</div>`;
  if (y && y.durum === 'hazirlaniyor') return `<div class="durum bekle">⏳ Değişiklikler kaydedildi, site hazırlanıyor (1–2 dakika)…</div>`;
  if (y && y.durum === 'yayinda') return `<div class="durum iyi">✓ Son değişiklikleriniz sitede yayında.${(y.sayfalar || []).length ? `<div class="guncellenen">Güncellenen sayfalar:<ul>${y.sayfalar.map((x) => `<li>${x.yol ? `<a href="${kacir(siteYolu(x.yol))}" target="_blank" rel="noopener">${kacir(x.ad)}</a>` : kacir(x.ad)}</li>`).join('')}</ul></div>` : ''}</div>`;
  if (y && y.durum === 'hata') return `<div class="durum hata">Site güncellenemedi; sitenin önceki hali yayında duruyor. Size e-posta da gitti.</div>`;
  if (y && y.durum === 'bilinmiyor') return `<div class="durum bekle">Değişiklikler kaydedildi ama sitede yayına girdiği henüz doğrulanamadı. “Siteyi aç” ile kontrol edebilirsiniz.</div>`;
  const n = bekleyenSayisi();
  return n ? `<div class="durum bekle">${n} değişiklik henüz yayında değil.</div>` : `<div class="durum iyi">✓ Siteniz güncel.</div>`;
}

function albumSatiri(al) {
  const g = gorunenAlbum(al); const L = liste(g).filter((x) => x.gorsel);
  const kapak = al.tur === 'vaka' ? (g.veri.kapak || L[0]?.gorsel) : al.tur === 'anasayfa' ? g.veri.yilbasi?.gorsel : L[0]?.gorsel;
  const n = bekleyenSayisi(al.id);
  return `<li><button class="satir" data-album="${kacir(al.id)}">
    ${al.tur === 'fiyatlar' ? '<span class="bos ikon">₺</span>' : al.tur === 'iletisim' ? '<span class="bos ikon">☎</span>' : al.tur === 'html' ? '<span class="bos ikon yazi">Aa</span>' : kapak ? `<img loading="lazy" src="${kacir(resimAdresi(kapak))}" alt="">` : '<span class="bos"></span>'}
    <span class="ad"><b>${kacir(al.ad)}</b><small>${kacir(al.aciklama)}${al.alan ? ' · ' + L.length + ' fotoğraf' : ''}</small></span>
    ${n ? `<span class="rozet">${n}</span>` : ''}</button></li>`;
}

function anaEkran() {
  const q = D.ara.toLocaleLowerCase('tr');
  const uy = (a) => !q || a.ad.toLocaleLowerCase('tr').includes(q);
  const grup = (tur, baslik, altGrup) => {
    const A = D.albumler.filter((a) => a.tur === tur && (!altGrup || a.grup === altGrup) && uy(a));
    return A.length ? `${baslik ? `<div class="bolum">${baslik}</div>` : ''}<ul class="liste">${A.map(albumSatiri).join('')}</ul>` : '';
  };
  kok.innerHTML = `<div class="ust"><h1>IstanbulPrintLab</h1><a class="dugme ust-baglanti" href="${SITE}/" target="_blank" rel="noopener">Siteyi aç</a></div>
    ${durumSatiri()}
    <button class="buyuk-ekle" id="ekle"><span>+</span> Fotoğraf ekle</button>
    <a class="dugme tam odeme-link" href="/yonetim/odeme-linki/">💳 Ödeme linki oluştur (kart ile ödeme)</a>
    <a class="dugme tam odeme-link" href="/yonetim/odemeler/">📋 Ödemeler ve fatura bilgileri</a>
    <input class="ara" id="ara" type="search" placeholder="Sayfa ara (ör. sticker, branda)" value="${kacir(D.ara)}">
    ${grup('fiyatlar', 'Fiyatlar')}${grup('anasayfa', 'Anasayfa')}${grup('html', '', 'ana')}${grup('projeler', '')}${grup('galeri', 'Projelerimiz ve referanslarımız (kategoriler)')}${grup('sayfa', 'Ürün sayfaları')}${grup('vaka', 'Vaka çalışmaları')}<button class="dugme tam" id="yeniVaka">+ Yeni vaka çalışması</button>${grup('html', 'Bilgi sayfaları', 'bilgi')}${grup('html', 'Semt sayfaları', 'semt')}${grup('html', 'Rehber yazıları', 'rehber')}${grup('iletisim', 'Site ayarları')}
    <button class="dugme tam ara-bosluk" id="baglantiKontrol">Satış bağlantılarını kontrol et (WhatsApp, telefon, e-posta, form)</button>
    <div class="alt-bilgi"><button id="cikis">Bu telefondan çıkış yap</button></div>`;
  $('#ekle').onclick = () => fotoSec(null);
  if ($('#yeniVaka')) $('#yeniVaka').onclick = yeniVakaEkrani;
  $('#baglantiKontrol').onclick = baglantiKontrolu;
  const ara = $('#ara'); ara.oninput = () => { D.ara = ara.value; const p = ara.selectionStart; anaEkran(); const a2 = $('#ara'); a2.focus(); a2.setSelectionRange(p, p); };
  kok.querySelectorAll('[data-album]').forEach((b) => b.onclick = () => git({ ad: 'album', id: b.dataset.album }));
  $('#cikis').onclick = async () => {
    if (!confirm('Bu telefondan çıkış yapılsın mı? Yayınlanmamış değişiklikler telefonda kalır.')) return;
    await fetch(ARACI, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    D.giris = false; ciz();
  };
  yayinCubugu();
}

function albumEkrani(id) {
  const al = D.albumler.find((a) => a.id === id); if (!al) return git({ ad: 'ana' }, true);
  const g = gorunenAlbum(al); const L = liste(g);
  const S = SEMA[al.tur];
  const sekmeler = [al.alan ? ['foto', 'Fotoğraflar'] : null, S ? ['metin', 'Metinler'] : null, S && S.google ? ['google', 'Google'] : null].filter(Boolean);
  const sekme = sekmeler.some(([k]) => k === D.ekran.sekme) ? D.ekran.sekme : sekmeler[0][0];
  let govde = '';
  if (sekme === 'foto') {
    const yeniler = new Set(D.islemler.filter((i) => i.album === id && i.tur === 'ekle').map((i) => i.gorsel));
    const ilkEtiket = al.tur === 'sayfa' ? 'Ana fotoğraf' : al.tur === 'projeler' ? 'İlk kart' : al.tur === 'galeri' ? 'Kapak' : '';
    const kapak = al.tur === 'vaka' ? g.veri.kapak : null;
    govde = `<div class="aciklama-not">${al.tur === 'sayfa' ? 'İlk fotoğraf sayfanın en üstünde büyük görünen ana fotoğraftır.' : al.tur === 'projeler' ? 'Her fotoğraf anasayfada bir proje kartıdır. Yeni eklenen en başa gelir.' : al.tur === 'galeri' ? 'Kategorinin fotoğrafları. İlk fotoğraf anasayfadaki kategori kartının kapağıdır.' : 'Vaka sayfasındaki “Uygulamadan kareler” bölümü.'} Düzenlemek için fotoğrafa dokunun.</div>
    <div class="izgara">${L.map((x, n) => !x.gorsel ? '' : `<button class="kare ${x.gizle ? 'soluk' : ''}" data-g="${kacir(x.gorsel)}">
        ${/\.mp4$/i.test(x.gorsel) ? `<video muted playsinline preload="metadata" src="${kacir(resimAdresi(x.gorsel))}"></video>` : `<img loading="lazy" src="${kacir(resimAdresi(x.gorsel))}" alt="">`}
        ${yeniler.has(x.gorsel) ? '<span class="etiket yeni">Yayında değil</span>' : x.gizle ? '<span class="etiket gizli">Gizli</span>' : (x.gorsel === kapak ? '<span class="etiket">Kapak</span>' : (n === 0 && ilkEtiket ? `<span class="etiket">${ilkEtiket}</span>` : ''))}
      </button>`).join('')}</div>
    ${L.length ? '' : '<div class="aciklama-not">Bu sayfada henüz fotoğraf yok. + düğmesiyle ekleyin.</div>'}
    <button class="fab" id="fab" aria-label="Bu sayfaya fotoğraf ekle">+</button>`;
  } else if (sekme === 'metin') {
    const bu = D.islemler.filter((i) => i.album === id && (i.tur === 'alan' || i.tur === 'liste'));
    govde = (bu.length ? `<div class="degisiklik-kutu"><b>Bu sayfada ${bu.length} yazı değişikliği yayın bekliyor</b><ul class="metin-ozet">${bu.map((i) => `<li>${metinDegisikligiOzeti(i)}</li>`).join('')}</ul></div>` : '')
      + `<div class="aciklama-not">Sitede göründüğü sırayla. Değiştirmek için dokunun.</div>${metinSekmesi(al, g)}`;
  } else {
    govde = googleSekmesi(al, g);
  }
  kok.innerHTML = `<div class="ust"><button class="geri" id="geri" aria-label="Geri">‹</button><h1>${kacir(al.ad)}</h1>
      <a class="dugme ust-baglanti" href="${kacir(siteYolu(al.sayfa))}" target="_blank" rel="noopener">Sayfayı aç</a></div>
    ${al.yeni ? `<div class="degisiklik-kutu"><b>Bu sayfa henüz sitede yok.</b> “Yayınla” ile birlikte oluşturulur. Metinler sekmesinden ihtiyaç, zorluk ve çözümü yazın; Fotoğraflar sekmesinden kareleri ekleyin.<button class="dugme tehlike tam ara-bosluk" id="vakaIptal">Bu yeni vakayı iptal et</button></div>` : ''}
    ${sekmeler.length > 1 ? `<div class="sekmeler" role="tablist">${sekmeler.map(([k, ad]) => `<button role="tab" data-sekme="${k}" aria-selected="${k === sekme}" class="${k === sekme ? 'secili' : ''}">${ad}</button>`).join('')}</div>` : ''}
    ${govde}`;
  $('#geri').onclick = () => history.back();
  kok.querySelectorAll('[data-sekme]').forEach((b) => b.onclick = () => { D.ekran = { ...D.ekran, sekme: b.dataset.sekme }; history.replaceState(D.ekran, ''); ciz(); });
  if ($('#fab')) $('#fab').onclick = () => fotoSec(id);
  if ($('#vakaIptal')) $('#vakaIptal').onclick = async () => {
    if (!confirm('Bu yeni vaka çalışması ve içine eklediğiniz her şey taslaktan silinsin mi?')) return;
    // Bu vakaya taşınmış fotoğraflar kaynak sayfalarında kalır.
    const at = D.islemler.filter((i) => i.album === id || i.tasiHedef === id);
    const dosyalar = at.flatMap((i) => [i.tur === 'ekle' && !i.tasindi ? i.gorsel : null, ...islemDosyalari(i)]).filter(Boolean);
    try { await taslakYaz(D.islemler.filter((i) => !at.includes(i)), { dosyaSil: dosyalar }); } catch (e) { return hataPenceresi('Kaydedilemedi', e.message); }
    D.albumler = D.albumler.filter((a) => a.id !== id); git({ ad: 'ana' }, true);
  };
  kok.querySelectorAll('.kare').forEach((b) => b.onclick = () => fotoDetay(al, b.dataset.g));
  kok.querySelectorAll('.kare img').forEach((im) => im.onerror = () => { if (!im.dataset.yedek) { im.dataset.yedek = 1; im.src = `https://raw.githubusercontent.com/${REPO}/${DAL}/site${im.closest('.kare').dataset.g}`; } });
  kok.querySelectorAll('[data-yol]').forEach((b) => b.onclick = () => { const def = alanBul(al.tur, JSON.parse(b.dataset.yol)); if (def) alanDuzenle(al, def); });
  yayinCubugu();
}

function yayinCubugu() {
  const n = bekleyenSayisi();
  const eski = $('.yayin-cubugu'); if (eski) eski.remove();
  if (!n) return;
  const c = document.createElement('div'); c.className = 'yayin-cubugu';
  c.innerHTML = (yayinKilitli() ? `<div class="bilgi"><b>${n} değişiklik bekliyor</b>Önceki yayın kontrol ediliyor</div>` : `<div class="bilgi"><b>${n} değişiklik hazır</b>Henüz sitede değil</div>`) + `
    <button class="dugme" id="vazgec">Geri al</button><button class="dugme ana" id="yayinla">Yayınla</button>`;
  kok.appendChild(c);
  $('#yayinla').onclick = () => yayinKilitli() ? yayinla() : yayinOnay();
  $('#vazgec').onclick = async () => {
    if (!confirm('Henüz yayınlanmamış ' + n + ' değişikliğin HEPSİ silinsin mi? Sitedeki hiçbir şey değişmez.')) return;
    try { await taslakYaz([], { dosyaTemizle: true }); } catch (e) { bildir(e.message, 5000); }
    ciz();
  };
}

// Alttan açılan pencere. kilitli: işlem sürerken dışına dokunarak kapatılamaz.
function perde(icerik, { kapaninca, kilitli, tam } = {}) {
  const p = document.createElement('div'); p.className = 'perde' + (tam ? ' tam' : '');
  p.innerHTML = `<div class="sayfa" role="dialog" aria-modal="true"><div class="tutamak"></div>${icerik}</div>`;
  p.onclick = (e) => { if (!kilitli && e.target === p) { p.remove(); kapaninca && kapaninca(); } };
  document.body.appendChild(p);
  return p;
}
function hataPenceresi(baslik, mesaj, ek = '') {
  const p = perde(`<h2>${kacir(baslik)}</h2><div class="hata-kutu bosluksuz">${kacir(mesaj)}</div>${ek}<button class="dugme ana tam ara-bosluk" data-tamam>Tamam</button>`);
  $('[data-tamam]', p).onclick = () => p.remove();
  return p;
}

// ---------- fotoğraf ekleme akışı ----------
function fotoSec(albumId) {
  if (D.kayitHatasi) { hataPenceresi('Şu an fotoğraf eklenemiyor', 'Telefon hafızasına kayıt yapılamıyor. Önce bekleyen değişiklikleri yayınlayın ya da telefonda yer açın.'); return; }
  const inp = $('#dosya'); inp.value = '';
  inp.onchange = () => {
    const F = [...inp.files];
    if (!F.length) return;
    if (F.length > EN_FAZLA_SECIM) { hataPenceresi('Çok fazla fotoğraf', `Tek seferde en fazla ${EN_FAZLA_SECIM} fotoğraf seçebilirsiniz. Kalanları ikinci seferde ekleyin.`); return; }
    hedefSec(F, albumId);
  };
  inp.click();
}

function hedefSec(F, albumId) {
  if (albumId) return eklemeFormu(F, D.albumler.find((a) => a.id === albumId));
  const onceki = D.sonKullanilan.map((id) => D.albumler.find((a) => a.id === id)).filter((a) => a && a.alan);
  const satir = (a) => `<li><button class="satir" data-h="${kacir(a.id)}"><span class="ad"><b>${kacir(a.ad)}</b><small>${kacir(a.aciklama)}</small></span></button></li>`;
  const p = perde(`<h2>${F.length} fotoğraf · Nereye eklensin?</h2>
    <input class="ara perde-ara" id="hara" type="search" placeholder="Sayfa ara">
    <ul class="liste" id="hliste"></ul>`);
  const doldur = (q) => {
    q = (q || '').toLocaleLowerCase('tr');
    const tum = D.albumler.filter((a) => a.alan && (!q || a.ad.toLocaleLowerCase('tr').includes(q)));
    const ust = q ? [] : onceki;
    $('#hliste', p).innerHTML = (ust.length ? '<div class="bolum perde-bolum">Son kullanılanlar</div>' + ust.map(satir).join('') + '<div class="bolum perde-bolum">Tüm sayfalar</div>' : '') + tum.map(satir).join('');
    p.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { p.remove(); eklemeFormu(F, D.albumler.find((a) => a.id === b.dataset.h)); });
  };
  doldur(''); $('#hara', p).oninput = (e) => doldur(e.target.value);
}

async function eklemeFormu(F, al) {
  const p = perde(`<h2>Fotoğraflar hazırlanıyor…</h2><div class="ilerleme"><i id="ilr"></i></div><div class="aciklama-not perde-not" id="ilm"></div>`, { kilitli: true });
  const hazir = []; const hatalar = [];
  for (let n = 0; n < F.length; n++) {
    $('#ilm', p).textContent = (n + 1) + ' / ' + F.length;
    try { hazir.push(await kucult(F[n])); }
    catch (e) { hatalar.push((F[n].name || 'Fotoğraf') + ': ' + e.message); }
    $('#ilr', p).style.width = Math.round(((n + 1) / F.length) * 100) + '%';
  }
  p.remove();
  if (hatalar.length) hataPenceresi(hatalar.length + ' fotoğraf hazırlanamadı', hatalar.join('\n'), '<div class="aciklama-not perde-not2">Bu fotoğrafları iPhone ayarlarında Kamera → Biçimler → “En Uyumlu” seçerek yeniden çekebilir ya da ekran görüntüsünü ekleyebilirsiniz.</div>');
  if (!hazir.length) return;
  for (const h of hazir) h.url = URL.createObjectURL(h.blob);
  const birak = () => hazir.forEach((h) => URL.revokeObjectURL(h.url));
  const proje = al.tur === 'projeler';
  const kart = (h, n) => `<div class="ekle-kart">
    <img class="onizleme" src="${h.url}" alt="">
    ${proje ? `<label class="alan"><span>Başlık (firma / proje) — zorunlu</span><input data-n="${n}" data-k="baslik" placeholder="Örn. Antre Gourmet"></label>
               <label class="alan"><span>Ne yapıldı? (isteğe bağlı)</span><input data-n="${n}" data-k="kisa" placeholder="Örn. Cam vitrine folyo kesim yazı"></label>`
            : `<label class="alan"><span>Fotoğrafta ne var? (isteğe bağlı)</span><input data-n="${n}" data-k="aciklama" placeholder="Örn. Mağaza camına uygulanmış logo sticker"></label>`}
  </div>`;
  const f = perde(`<h2>${kacir(al.ad)}</h2>
    <div class="aciklama-not perde-not">${proje ? 'Her fotoğraf anasayfada bir proje kartı olur.' : 'Kısa bir açıklama Google’da bulunmanıza yardım eder. Boş bırakırsanız sayfa adı kullanılır.'}</div>
    ${hazir.map(kart).join('')}
    <button class="dugme ana tam" id="hazir">${hazir.length > 1 ? hazir.length + ' fotoğrafı ekle' : 'Ekle'}</button>
    <button class="dugme tam ara-bosluk" id="iptal">Vazgeç</button>`, { kapaninca: birak });
  $('#iptal', f).onclick = () => { birak(); f.remove(); };
  $('#hazir', f).onclick = async () => {
    const deger = (n, k) => ($(`[data-n="${n}"][data-k="${k}"]`, f)?.value || '').trim();
    if (proje && hazir.some((_, n) => !deger(n, 'baslik'))) { bildir('Her proje kartı için bir başlık yazın.'); return; }
    const damga = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const yeni = []; const dosyalar = []; const onz = {};
    for (let n = 0; n < hazir.length; n++) {
      const h = hazir[n];
      const ad = `${slug(proje ? deger(n, 'baslik') : al.ad)}-${damga}-${Math.random().toString(36).slice(2, 6)}.jpg`;
      const gorsel = `/img/yuklenen/${al.klasor}/${ad}`;
      dosyalar.push([gorsel, h.blob]); onz[gorsel] = h.url;
      const i = { tur: 'ekle', album: al.id, gorsel, taban: al.oid };
      if (proje) { i.baslik = deger(n, 'baslik'); i.kisa = deger(n, 'kisa'); i.alt = [i.baslik, i.kisa].filter(Boolean).join(' — '); }
      else i.aciklama = deger(n, 'aciklama') || al.ad;
      yeni.push(i);
    }
    const onceki = D.sonKullanilan;
    D.sonKullanilan = [al.id, ...onceki.filter((x) => x !== al.id)].slice(0, 5);
    try { await taslakYaz([...D.islemler, ...yeni], { dosyaEkle: dosyalar }); }
    catch (e) { D.sonKullanilan = onceki; birak(); f.remove(); hataPenceresi('Eklenemedi', e.message); ciz(); return; }
    Object.assign(D.onizleme, onz);
    f.remove();
    bildir(hazir.length + ' fotoğraf eklendi. Hazır olunca “Yayınla”ya basın.', 3500);
    git({ ad: 'album', id: al.id });
  };
}

// ---------- fotoğraf düzenleme ----------
function fotoDetay(al, gorsel) {
  const g = gorunenAlbum(al); const L = liste(g); const n = L.findIndex((x) => x.gorsel === gorsel); const x = L[n];
  if (!x) return;
  const proje = al.tur === 'projeler';
  const p = perde(`<img class="onizleme" src="${kacir(resimAdresi(gorsel))}" alt="">
    ${proje ? `<label class="alan"><span>Başlık</span><input id="d1" value="${kacir(x.baslik)}"></label>
               <label class="alan"><span>Ne yapıldı?</span><input id="d2" value="${kacir(x.aciklama)}"></label>
               <label class="alan"><span>Küçük etiket (başlığın üstünde) — hazır seçimlere dokunarak ekleyin, en fazla 3</span><input id="d3" value="${kacir(x.etiket || '')}" placeholder="Örn. Perakende · Cephe"></label>
               <div class="secenekler cipler">${['Cephe', 'Tabela', 'Mağaza', 'Ofis', 'AVM', 'Otel', 'Fuar', 'Cam filmi', 'Araç giydirme'].map((c) => `<button type="button" data-cip="${c}">${c}</button>`).join('')}</div>
               <label class="alan"><span>Karta tıklayınca</span><select class="duz" id="d4"><option value="">Teklif formu açılsın</option>${D.albumler.filter((a) => a.tur === 'vaka').map((a) => `<option value="${kacir(a.sayfa)}" ${a.sayfa === (x.baglanti || '') ? 'selected' : ''}>Vaka sayfası: ${kacir(a.ad)}</option>`).join('')}</select></label>`
            : `<label class="alan"><span>Fotoğrafta ne var?</span><input id="d1" value="${kacir(x.aciklama)}"></label>`}
    <div class="dugmeler">
      <button class="dugme tam" id="kaydet">Yazıyı kaydet</button>
      <button class="dugme tam" id="basa" ${n === 0 ? 'disabled' : ''}>${al.tur === 'sayfa' ? 'Ana fotoğraf yap (en üste)' : 'En başa al'}</button>
      <button class="dugme" id="sol" ${n === 0 ? 'disabled' : ''}>◀ Bir öne</button>
      <button class="dugme" id="sag" ${n === L.length - 1 ? 'disabled' : ''}>Bir arkaya ▶</button>
      ${al.tur === 'vaka' ? `<button class="dugme tam" id="kapak" ${g.veri.kapak === gorsel ? 'disabled' : ''}>Sayfanın kapak fotoğrafı yap</button>` : ''}
      <button class="dugme tam" id="tasi">Başka sayfaya taşı</button>
      ${proje ? `<button class="dugme tam" id="gizle">${x.gizle ? 'Anasayfada tekrar göster' : 'Anasayfada geçici gizle'}</button>` : ''}
      <button class="dugme tehlike tam" id="kaldir">Sayfadan kaldır</button>
    </div>`);
  const ekle = async (i, mesaj) => {
    try { await taslakYaz([...D.islemler, { album: al.id, gorsel, taban: al.oid, ...i }]); }
    catch (e) { p.remove(); hataPenceresi('Kaydedilemedi', e.message); return ciz(); }
    p.remove(); if (mesaj) bildir(mesaj); ciz();
  };
  p.querySelectorAll('[data-cip]').forEach((b) => b.onclick = () => { const e = $('#d3', p); const L = e.value.split('·').map((t) => t.trim()).filter(Boolean); if (!L.includes(b.dataset.cip)) L.push(b.dataset.cip); e.value = L.slice(-3).join(' · '); });
  $('#kaydet', p).onclick = () => proje ? ekle({ tur: 'duzenle', baslik: $('#d1', p).value.trim(), kisa: $('#d2', p).value.trim(), etiket: $('#d3', p).value.trim().slice(0, 60), baglanti: $('#d4', p).value }, 'Kaydedildi') : ekle({ tur: 'duzenle', aciklama: $('#d1', p).value.trim() }, 'Kaydedildi');
  $('#basa', p).onclick = () => ekle({ tur: 'basa' });
  $('#sol', p).onclick = () => ekle({ tur: 'tasi', yon: -1 });
  $('#sag', p).onclick = () => ekle({ tur: 'tasi', yon: 1 });
  if ($('#kapak', p)) $('#kapak', p).onclick = () => ekle({ tur: 'kapak' }, 'Kapak olarak işaretlendi');
  if ($('#gizle', p)) $('#gizle', p).onclick = () => ekle({ tur: 'gizle', deger: !x.gizle });
  $('#tasi', p).onclick = () => {
    if (al.tur === 'vaka' && g.veri.kapak === gorsel) return hataPenceresi('Kapak fotoğrafı taşınamaz', 'Bu fotoğraf vaka sayfasının kapağı. Önce başka bir fotoğrafı kapak yapın, sonra taşıyın.');
    if (D.islemler.some((i) => i.album === al.id && i.tur === 'ekle' && i.gorsel === gorsel)) return hataPenceresi('Henüz taşınamaz', 'Bu fotoğraf henüz sitede değil. Taşımak yerine bu sayfadan kaldırıp istediğiniz sayfaya yeniden ekleyin.');
    const hedefler = D.albumler.filter((a) => a.alan && a.id !== al.id && !a.en);
    const p2 = perde(`<h2>Hangi sayfaya taşınsın?</h2><div class="aciklama-not perde-not2">Fotoğraf bu sayfadan kaldırılıp seçtiğiniz sayfanın sonuna eklenir. Yayınlayana kadar sitede bir şey değişmez.</div>
      <ul class="liste">${hedefler.map((a) => `<li><button class="satir" data-hedef="${kacir(a.id)}"><span class="ad"><b>${kacir(a.ad)}</b><small>${kacir(a.aciklama)}</small></span></button></li>`).join('')}</ul>
      <button class="dugme tam ara-bosluk" id="vz">Vazgeç</button>`, { tam: true });
    $('#vz', p2).onclick = () => p2.remove();
    p2.querySelectorAll('[data-hedef]').forEach((b) => b.onclick = async () => {
      const h = D.albumler.find((a) => a.id === b.dataset.hedef); if (!h) return;
      if (liste(gorunenAlbum(h)).some((y) => y.gorsel === gorsel)) return hataPenceresi('Taşınamadı', 'Bu fotoğraf o sayfada zaten var.');
      const yazi = proje ? [x.baslik, x.aciklama].filter(Boolean).join(' — ') : x.aciklama;
      const ek = { tur: 'ekle', album: h.id, gorsel, taban: h.oid, tasindi: true, kaynak: al.id };
      if (h.tur === 'projeler') { ek.baslik = proje ? x.baslik : (x.aciklama || al.ad).slice(0, 80); ek.kisa = proje ? x.aciklama : ''; ek.alt = [ek.baslik, ek.kisa].filter(Boolean).join(' — '); } else ek.aciklama = yazi || h.ad;
      try { await taslakYaz([...D.islemler, { album: al.id, gorsel, taban: al.oid, tur: 'kaldir', tasiHedef: h.id }, ek]); }
      catch (e) { p2.remove(); p.remove(); hataPenceresi('Kaydedilemedi', e.message); return ciz(); }
      p2.remove(); p.remove(); bildir(`Taşındı: ${h.ad} — henüz sitede değil.`, 3500); ciz();
    });
  };
  $('#kaldir', p).onclick = async () => {
    if (!confirm('Bu fotoğraf sayfadan kaldırılsın mı? (Dosya arşivde kalır, istenirse geri eklenebilir.)')) return;
    // Henüz yayınlanmamış yeni bir fotoğrafsa taslaktan tamamen çıkar. Taşınmış bir fotoğrafsa taşıma bütünüyle geri alınır.
    const yeni = D.islemler.find((i) => i.album === al.id && i.tur === 'ekle' && i.gorsel === gorsel);
    if (yeni) {
      const at = (i) => (i.album === al.id && i.gorsel === gorsel) || (yeni.tasindi && i.album === yeni.kaynak && i.tur === 'kaldir' && i.gorsel === gorsel && i.tasiHedef === al.id);
      try { await taslakYaz(D.islemler.filter((i) => !at(i)), { dosyaSil: yeni.tasindi ? [] : [gorsel] }); }
      catch (e) { p.remove(); hataPenceresi('Kaydedilemedi', e.message); return ciz(); }
      p.remove(); return ciz();
    }
    ekle({ tur: 'kaldir' }, 'Kaldırıldı');
  };
}

// ---------- metinler ve Google görünümü ----------
const esit = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function yolAl(o, yol) { return yol.reduce((x, k) => (x == null ? undefined : x[k]), o); }
function yolKoy(o, yol, v) {
  let x = o;
  for (let n = 0; n < yol.length - 1; n++) { if (x[yol[n]] == null || typeof x[yol[n]] !== 'object') x[yol[n]] = {}; x = x[yol[n]]; }
  x[yol[yol.length - 1]] = v;
}
const kopya = (v) => JSON.parse(JSON.stringify(v ?? null));

// Sayfa türlerine göre düzenlenebilir alanlar (sitede göründükleri sırayla).
const SEMA = {
  sayfa: {
    metin: [
      { yol: ['etiket'], ad: 'Küçük üst yazı', tip: 'satir', ipucu: 'Başlığın üstündeki küçük gri yazı. Örn: Küçük format · İç ve dış mekan' },
      { yol: ['baslik'], ad: 'Sayfa başlığı', tip: 'satir', zorunlu: true, ipucu: 'Sayfanın en büyük başlığı.' },
      { yol: ['giris'], ad: 'Giriş yazısı', tip: 'paragraf', ipucu: 'Başlığın altındaki tanıtım paragrafı.' },
      { yol: ['neden'], ad: 'Ürün avantajları', tip: 'liste', oge: 'metin', ogeAd: 'Madde' },
      { yol: ['ozellikler'], ad: 'Teknik özellikler', tip: 'liste', oge: 'cift', ogeAd: 'Özellik', alanlar: [['ad', 'Özellik adı (örn. Malzeme)'], ['deger', 'Değeri']] },
      { yol: ['sss'], ad: 'Sık sorulan sorular', tip: 'liste', oge: 'sss', ogeAd: 'Soru' },
    ],
    google: true,
  },
  vaka: {
    metin: [
      { yol: ['firma'], ad: 'Firma adı', tip: 'satir', zorunlu: true },
      { yol: ['etiket'], ad: 'Küçük üst yazı', tip: 'satir' },
      { yol: ['baslik'], ad: 'Sayfa başlığı', tip: 'satir', zorunlu: true },
      { yol: ['ihtiyac'], ad: 'Müşterinin ihtiyacı', tip: 'paragraf' },
      { yol: ['zorluk'], ad: 'İşin zorluğu', tip: 'paragraf' },
      { yol: ['cozum'], ad: 'Çözümümüz (maddeler)', tip: 'liste', oge: 'metin', ogeAd: 'Madde' },
      { yol: ['bilgiler'], ad: 'Proje bilgileri', tip: 'liste', oge: 'cift', ogeAd: 'Bilgi', alanlar: [['ad', 'Bilgi adı (örn. Müşteri)'], ['deger', 'Değeri']] },
    ],
    google: true,
  },
  anasayfa: {
    metin: [
      { yol: ['ust_baslik'], ad: 'Üst yazı', tip: 'satir' },
      { yol: ['buyuk_baslik'], ad: 'Büyük başlık (satır satır)', tip: 'liste', oge: 'metin', ogeAd: 'Satır', enAz: 1 },
      { yol: ['giris'], ad: 'Giriş yazısı', tip: 'paragraf' },
      { yol: ['hiz_notu'], ad: 'Teslim süresi notu', tip: 'paragraf' },
      { yol: ['urun_dugmeleri'], ad: 'Sipariş düğmeleri (üstteki 15 düğme)', tip: 'liste', oge: 'kart', ogeAd: 'Düğme', sabit: true, baslikAlan: 'ad',
        ipucu: 'Sıralayabilir, adını değiştirebilir, gizleyebilirsiniz. Yeni düğme fiyat hesaplayıcısı gerektirdiği için buradan eklenemez. Fiyatlar otomatik gelir.',
        alanlar: [['ad', 'Düğme yazısı', 'satir'], ['goster', 'Anasayfada göster', 'anahtar']] },
      { yol: ['one_cikanlar'], ad: 'Öne çıkan ürünlerimiz', tip: 'liste', oge: 'kart', ogeAd: 'Ürün kartı', baslikAlan: 'baslik',
        alanlar: [['gorsel', 'Fotoğraf', 'gorsel'], ['gorsel_aciklama', 'Fotoğraf açıklaması', 'satir'], ['ust_yazi', 'Üst etiket (ör. Sezon ürünü)', 'satir'], ['baslik', 'Ürün adı', 'satir', true],
          ['aciklama', 'Kısa açıklama', 'uzun'], ['fiyat', 'Fiyat satırı', 'uzun'], ['dugme', 'Düğme yazısı', 'satir'], ['baglanti', 'Düğmeye basınca gidilecek adres (ör. /roll-up-baski/)', 'adres'], ['goster', 'Anasayfada göster', 'anahtar']] },
      { yol: ['ne_yapiyoruz'], ad: 'Ne yapıyoruz (hizmet kartları)', tip: 'liste', oge: 'kart', ogeAd: 'Hizmet kartı', baslikAlan: 'baslik',
        alanlar: [['gorsel', 'Kapak fotoğrafı', 'gorsel'], ['gorsel_aciklama', 'Fotoğraf açıklaması', 'satir'], ['baslik', 'Hizmet adı', 'satir', true], ['aciklama', 'Kısa açıklama', 'uzun'],
          ['etiket', 'Etiket (ör. Teklif ile)', 'satir'], ['baglanti', 'Karta basınca gidilecek adres (ör. /folyo-kaplama/)', 'adres'], ['goster', 'Anasayfada göster', 'anahtar']] },
      { yol: ['referanslar'], ad: 'Referanslarımız (isimler)', tip: 'liste', oge: 'metin', ogeAd: 'Referans' },
      { yol: ['hakkimizda_kisa'], ad: 'Kısa hakkımızda yazısı', tip: 'paragraf' },
      { yol: ['sss'], ad: 'Sık sorulan sorular', tip: 'liste', oge: 'sss', ogeAd: 'Soru' },
    ],
    donemsel: [
      { baslik: 'Yılbaşı kutusu', alanlar: [
        { yol: ['yilbasi', 'goster'], ad: 'Anasayfada göster', tip: 'anahtar', ipucu: 'Sezon bitince kapatmayı unutmayın.' },
        { yol: ['yilbasi', 'gorsel'], ad: 'Fotoğraf', tip: 'gorsel', klasor: 'anasayfa' },
        { yol: ['yilbasi', 'gorsel_aciklama'], ad: 'Fotoğraf açıklaması', tip: 'satir', ipucu: 'Fotoğrafta ne görünüyor? Google ve görme engelli ziyaretçiler için.' },
        { yol: ['yilbasi', 'ust_yazi'], ad: 'Üst yazı', tip: 'satir' },
        { yol: ['yilbasi', 'baslik'], ad: 'Başlık', tip: 'satir' },
        { yol: ['yilbasi', 'maddeler'], ad: 'Maddeler', tip: 'liste', oge: 'metin', ogeAd: 'Madde' },
      ] },
      { baslik: 'Cam filmi kutusu (şu an anasayfada gizli)', alanlar: [
        { yol: ['cam_filmi', 'ust_yazi'], ad: 'Üst yazı', tip: 'satir' },
        { yol: ['cam_filmi', 'baslik'], ad: 'Başlık', tip: 'satir' },
        { yol: ['cam_filmi', 'giris'], ad: 'Yazı', tip: 'paragraf' },
      ] },
    ],
    google: true,
  },
  galeri: {
    metin: [
      { yol: ['baslik'], ad: 'Kategori adı', tip: 'satir', zorunlu: true },
      { yol: ['giris'], ad: 'Kısa açıklama', tip: 'paragraf' },
    ],
  },
  iletisim: { metin: [], google: false }, // alanlar ILETISIM_ALANLARI'nda (aşağıda)
};
const SEO_ALANLARI = [
  { yol: ['seo_baslik'], ad: 'Google başlığı', tip: 'satir', zorunlu: true, seo: 'baslik', ipucu: 'Google sonuçlarında mavi görünen başlık. Önerilen: 30–60 karakter.' },
  { yol: ['seo_aciklama'], ad: 'Google açıklaması', tip: 'paragraf', seo: 'aciklama', ipucu: 'Başlığın altındaki gri açıklama. Önerilen: 70–155 karakter.' },
];
function tumAlanlar(tur) {
  if (tur === 'iletisim') return ILETISIM_ALANLARI;
  const S = SEMA[tur]; if (!S) return [];
  return [...S.metin, ...(S.donemsel || []).flatMap((g) => g.alanlar), ...(S.google ? SEO_ALANLARI : [])];
}
const alanBul = (tur, yol) => tumAlanlar(tur).find((d) => esit(d.yol, yol));

// Korumalar: otomatik fiyatlar ({{...}}) ve bağlantı adresleri değiştirilemez; kalın işaretleri (**) eşli olmalı.
const metinleri = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(metinleri) : v && typeof v === 'object' ? Object.values(v).flatMap(metinleri) : []);
const say = (L) => L.slice().sort().join('\u0001');
const FIYAT_TOK = /\{\{[a-z0-9_]+(?:\*[\d.]+)?(?:\+kdv|:ham)?\}\}/g; // build.py'deki TOK ile aynı
function degiskenler(s) { return s.match(FIYAT_TOK) || []; }
function adresler(s) { return [...s.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)].map((m) => m[2]); }
function korumaHatasi(eski, yeni) {
  const E = metinleri(eski).join('\n'), Y = metinleri(yeni).join('\n');
  const kalan = Y.replace(FIYAT_TOK, '');
  if (/\{\{|\}\}/.test(kalan)) return 'Otomatik fiyat işareti ({{…}}) bozulmuş.';
  if (say(degiskenler(E)) !== say(degiskenler(Y))) { const eksik = degiskenler(E).filter((v) => !degiskenler(Y).includes(v)); return `Kaydetmek için otomatik fiyat kısmını koruyun${eksik.length ? ': ' + [...new Set(eksik)].join(', ') + ' metinde kalmalı' : ''}. Fiyatlar buradan değiştirilemez.`; }
  if (say(adresler(E)) !== say(adresler(Y))) return 'Metindeki bir bağlantının adresi silinmiş ya da değiştirilmiş. Bağlantı yazısını değiştirebilirsiniz, adresini değil.';
  if (/\]\(/.test(Y.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, ''))) return 'Bir bağlantının yazımı bozulmuş ( [yazı](adres) biçiminde olmalı ).';
  for (const t of metinleri(yeni)) if (((t.match(/\*\*/g) || []).length) % 2) return 'Kalın yazı işareti (**) eksik kalmış: her ** açılışın bir kapanışı olmalı.';
  return '';
}
const ADRES_DESEN = /^(https:\/\/[^\s"<>]+|\/[^\s"<>.]*(\.html)?|#[\w-]+)$/;
function bosHatasi(def, v) {
  if (def.zorunlu && !String(v || '').trim()) return `"${def.ad}" boş bırakılamaz.`;
  if (def.tip === 'liste') {
    if (def.enAz && v.length < def.enAz) return `En az ${def.enAz} ${def.ogeAd.toLocaleLowerCase('tr')} olmalı.`;
    for (const o of v) {
      if (def.oge === 'metin' && !String(o).trim()) return 'Boş madde bırakılamaz.';
      if (def.oge === 'cift' && (!String(o.ad || '').trim() || !String(o.deger || '').trim())) return 'Her satırın adı ve değeri dolu olmalı.';
      if (def.oge === 'kart') { for (const [k, ad, t, z] of def.alanlar) { if ((z || t === 'gorsel' || t === 'adres') && !String(o[k] || '').trim()) return `"${ad}" boş bırakılamaz.`; if (t === 'adres' && !ADRES_DESEN.test(String(o[k]).trim())) return 'Adres / ile başlamalı (ör. /folyo-kaplama/) ya da https:// ile tam adres olmalı.'; } }
      if (def.oge === 'sss' && (!String(o.soru || '').trim() || !String(o.cevap || '').trim())) return 'Her sorunun hem sorusu hem cevabı dolu olmalı.';
    }
  }
  return '';
}
function seoUyarilari(al, def, v) {
  const U = []; const n = String(v || '').trim().length;
  if (def.seo === 'baslik') {
    if (n && (n < 30 || n > 60)) U.push(`Başlık ${n} karakter; 30–60 arası genelde tam görünür.`);
    const ayni = D.albumler.filter((a) => a.id !== al.id && SEMA[a.tur]?.google && String(yolAl(gorunenAlbum(a).veri, ['seo_baslik']) || '').trim().toLocaleLowerCase('tr') === String(v).trim().toLocaleLowerCase('tr'));
    if (n && ayni.length) U.push('Aynı Google başlığı şu sayfada da var: ' + ayni.map((a) => a.ad).join(', ') + '. Her sayfanın başlığı farklı olmalı.');
  }
  if (def.seo === 'aciklama') {
    if (!n) U.push('Açıklama boş; Google sayfadan kendisi bir metin seçer.');
    else if (n < 70 || n > 155) U.push(`Açıklama ${n} karakter; 70–155 arası genelde tam görünür.`);
  }
  if (al.en && /[çğışöüÇĞİŞÖÜ]/.test(String(v))) U.push('İngilizce sayfada Türkçe harf kullanılmış: ' + [...new Set(String(v).match(/[çğışöüÇĞİŞÖÜ]/g))].join(', '));
  return U;
}

// Aynı bölümün değişiklikleri tek işlemde birleşir; başlangıç değeri (sitedeki hal) korunur.
async function alanKaydet(al, def, yeni, dosya, coklu = []) {
  const tur = def.tip === 'liste' ? 'liste' : 'alan';
  const onceki = D.islemler.find((i) => i.album === al.id && i.tur === tur && esit(i.yol, def.yol));
  const eski = onceki ? onceki.eski : kopya(yolAl(al.veri, def.yol));
  const kalan = D.islemler.filter((i) => i !== onceki);
  // Listedeki kart fotoğrafları: yalnızca hâlâ kullanılan yeni dosyalar tutulur.
  const metin = JSON.stringify(yeni);
  const tum = [...((onceki && onceki.dosyalar) || []), ...coklu.map((d) => d[0])];
  const tutulan = [...new Set(tum)].filter((y) => metin.includes(JSON.stringify(y)));
  const atilan = [...new Set(tum)].filter((y) => !tutulan.includes(y));
  const degisti = !esit(yeni, eski);
  const yeniler = degisti ? [...kalan, { tur, album: al.id, yol: def.yol, eski, yeni: kopya(yeni), ...(dosya ? { dosya: dosya[0] } : {}), ...(tutulan.length ? { dosyalar: tutulan } : {}) }] : kalan;
  await taslakYaz(yeniler, { dosyaEkle: [...(dosya ? [dosya] : []), ...coklu.filter((d) => degisti && tutulan.includes(d[0]))], dosyaSil: [...(onceki && onceki.dosya ? [onceki.dosya] : []), ...(degisti ? atilan : tum)] });
}
const islemDosyalari = (i) => [...(i.dosya ? [i.dosya] : []), ...(i.dosyalar || [])];
async function alanGeriAl(al, def) {
  const at = D.islemler.filter((i) => i.album === al.id && (i.tur === 'alan' || i.tur === 'liste') && esit(i.yol, def.yol));
  await taslakYaz(D.islemler.filter((i) => !at.includes(i)), { dosyaSil: at.flatMap(islemDosyalari) });
}
const bekleyenAlan = (al, def) => D.islemler.some((i) => i.album === al.id && (i.tur === 'alan' || i.tur === 'liste') && esit(i.yol, def.yol));

function onIzlemeMetni(def, v) {
  if (def.tip === 'gorsel') return v ? 'Fotoğrafı görmek ve değiştirmek için dokunun' : 'Fotoğraf yok';
  if (def.tip === 'anahtar') return v ? 'Açık — anasayfada görünüyor' + (def.ipucu ? ' · ' + def.ipucu : '') : 'Kapalı — anasayfada görünmüyor';
  if (def.tip === 'liste') {
    const L = Array.isArray(v) ? v : [];
    if (!L.length) return 'Henüz yok';
    const ilk = def.oge === 'metin' ? L[0] : def.oge === 'cift' ? `${L[0].ad}: ${L[0].deger}` : def.oge === 'kart' ? L[0][def.baslikAlan] : L[0].soru;
    if (def.oge === 'kart') { const gizli = L.filter((o) => o.goster === false).length; return `${L.length} ${def.ogeAd.toLocaleLowerCase('tr')}${gizli ? ` (${gizli} gizli)` : ''} · ${ilk}`; }
    return `${L.length} ${def.ogeAd.toLocaleLowerCase('tr')} · ${ilk}`;
  }
  return String(v || '').trim() || 'Boş';
}
const sade = (s) => String(s || '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1').replace(FIYAT_TOK, '[otomatik fiyat]');

function alanKarti(al, g, def) {
  const v = yolAl(g.veri, def.yol);
  return `<li><button class="metin-kart" data-yol="${kacir(JSON.stringify(def.yol))}">
    <span class="mk-ad">${kacir(def.ad)}${bekleyenAlan(al, def) ? ' <span class="rozet">değişti</span>' : ''}</span>
    <span class="mk-deger">${kacir(sade(onIzlemeMetni(def, v)))}</span></button></li>`;
}
function metinSekmesi(al, g) {
  const S = SEMA[al.tur];
  if (al.tur === 'iletisim') return `<div class="uyari">Buradaki değişiklik sitedeki BÜTÜN sayfalarda (teklif bölümü, alt bilgi, iletişim düğmeleri, Google işletme bilgisi) birlikte değişir. Telefon ve e-postayı iki kez yazmanız istenir.</div><ul class="liste kartlar">${ILETISIM_ALANLARI.map((d) => alanKarti(al, g, d)).join('')}</ul>`;
  let h = `<ul class="liste kartlar">${S.metin.map((d) => alanKarti(al, g, d)).join('')}</ul>`;
  for (const grup of S.donemsel || []) h += `<div class="bolum">${kacir(grup.baslik)}</div><ul class="liste kartlar">${grup.alanlar.map((d) => alanKarti(al, g, d)).join('')}</ul>`;
  return h;
}
function googleSekmesi(al, g) {
  const t = String(yolAl(g.veri, ['seo_baslik']) || ''), a = String(yolAl(g.veri, ['seo_aciklama']) || '');
  const adres = 'istanbulprintlab.com' + (al.sayfa === '/' ? '' : ' › ' + al.sayfa.replace(/^\/|\/$/g, '').split('/').join(' › '));
  return `<div class="g-onizleme"><div class="g-site">IstanbulPrintLab</div><div class="g-adres">${kacir(adres)}</div>
      <div class="g-baslik">${kacir(t || '(başlık yok)')}</div><div class="g-aciklama">${kacir(a || '(açıklama yok)')}</div></div>
    <div class="aciklama-not">Yaklaşık görünüm. Google başlığı ve açıklamayı farklı gösterebilir.</div>
    <ul class="liste kartlar">${SEO_ALANLARI.map((d) => alanKarti(al, g, d)).join('')}</ul>`;
}

// Tek satır / paragraf / aç-kapa düzenleyici (tam ekran).
function alanDuzenle(al, def, baslangic) {
  const g = gorunenAlbum(al);
  const ilk = baslangic !== undefined ? baslangic : yolAl(g.veri, def.yol);
  const orijinal = kopya(yolAl(al.veri, def.yol));
  if (def.tip === 'liste') return listeDuzenle(al, def, ilk);
  if (def.tip === 'gorsel') return gorselDuzenle(al, def, ilk);
  const p = perde(`<h2>${kacir(def.ad)}</h2>
    ${def.ipucu ? `<div class="aciklama-not perde-not">${kacir(def.ipucu)}</div>` : ''}
    ${def.tip === 'anahtar'
      ? `<label class="anahtar"><input type="checkbox" id="dg" ${ilk ? 'checked' : ''}><span>${kacir(def.ad)}</span></label>`
      : def.tip === 'satir' ? `<input class="duz" id="dg" value="${kacir(ilk)}">` : `<textarea class="duz" id="dg" rows="7">${kacir(ilk)}</textarea>`}
    ${def.tip !== 'anahtar' ? '<div class="sayac" id="sy"></div>' : ''}
    ${degiskenler(String(ilk || '')).length ? `<div class="kilit-not">🔒 ${kacir(degiskenler(String(ilk)).join(', '))} otomatik fiyattır; değiştirmeyin. Çevresindeki yazıyı düzenleyebilirsiniz.</div>` : ''}
    ${/\*\*/.test(String(ilk || '')) ? '<div class="aciklama-not perde-not">** işaretleri arasındaki yazı sitede kalın görünür.</div>' : ''}
    ${def.tekrar ? '<label class="alan"><span>Doğrulamak için aynısını tekrar yazın</span><input class="duz" id="dg2" autocomplete="off"></label>' : ''}
    <div id="uy"></div>
    <button class="dugme ana tam" id="kaydet">Kaydet</button>
    ${bekleyenAlan(al, def) ? '<button class="dugme tam ara-bosluk" id="geri">Bu değişikliği geri al (sitedeki hale dön)</button>' : ''}
    <button class="dugme tam ara-bosluk" id="vazgec">Vazgeç</button>`, { tam: true });
  const k = $('#dg', p);
  const oku = () => def.tip === 'anahtar' ? k.checked : k.value.replace(/\r/g, '').replace(def.tip === 'satir' ? /\n/g : /$^/, ' ');
  const guncelle = () => {
    if (def.tip === 'anahtar') return;
    const v = oku(); $('#sy', p).textContent = v.trim().length + ' karakter';
    const U = def.seo ? seoUyarilari(al, def, v) : [];
    $('#uy', p).innerHTML = U.map((u) => `<div class="uyari">${kacir(u)}</div>`).join('');
  };
  if (k.tagName !== 'INPUT' || k.type !== 'checkbox') k.oninput = guncelle;
  guncelle();
  $('#vazgec', p).onclick = () => p.remove();
  if ($('#geri', p)) $('#geri', p).onclick = async () => { try { await alanGeriAl(al, def); } catch (e) { return hataPenceresi('Kaydedilemedi', e.message); } p.remove(); bildir('Değişiklik geri alındı'); ciz(); };
  $('#kaydet', p).onclick = async () => {
    const v = def.tip === 'anahtar' ? oku() : oku().trim();
    const hata = bosHatasi(def, v) || (def.dogrula && def.tip !== 'anahtar' ? def.dogrula(v) : '') || (def.tekrar && !esit(v, orijinal) && $('#dg2', p).value.trim() !== v ? 'İki yazdığınız aynı değil. Lütfen dikkatle tekrar yazın.' : '') || korumaHatasi(orijinal, v);
    if (hata) {
      $('#uy', p).innerHTML = `<div class="hata-kutu bosluksuz">${kacir(hata)}</div>` + (degiskenler(String(orijinal || '')).length || adresler(String(orijinal || '')).length ? '<button class="dugme tam ara-bosluk" id="ilkhal">Yazıyı sitedeki haline döndür</button>' : '');
      if ($('#ilkhal', p)) $('#ilkhal', p).onclick = () => { k.value = orijinal || ''; guncelle(); };
      return;
    }
    try { await alanKaydet(al, def, v); } catch (e) { return hataPenceresi('Kaydedilemedi', e.message); }
    p.remove(); bildir('Telefona kaydedildi — henüz sitede değil. Hazır olunca “Yayınla”ya basın.', 3500); ciz();
  };
}


// Tek fotoğraf alanı (ör. anasayfa yılbaşı kutusu): yeni fotoğraf telefonda küçültülür, aynı yayında yüklenir; eski dosya silinmez.
function gorselDuzenle(al, def, simdi) {
  const p = perde(`<h2>${kacir(def.ad)}</h2>
    ${simdi ? `<img class="onizleme" src="${kacir(resimAdresi(simdi))}" alt="">` : '<div class="aciklama-not">Fotoğraf yok.</div>'}
    <button class="dugme ana tam" id="degistir">Fotoğrafı değiştir</button>
    ${bekleyenAlan(al, def) ? '<button class="dugme tam ara-bosluk" id="geri">Eski fotoğrafa dön</button>' : ''}
    <button class="dugme tam ara-bosluk" id="vazgec">Kapat</button>`, { tam: true });
  $('#vazgec', p).onclick = () => p.remove();
  if ($('#geri', p)) $('#geri', p).onclick = async () => { try { await alanGeriAl(al, def); } catch (e) { return hataPenceresi('Kaydedilemedi', e.message); } p.remove(); ciz(); };
  $('#degistir', p).onclick = () => {
    const inp = $('#dosya'); inp.value = ''; inp.multiple = false;
    inp.onchange = async () => {
      inp.multiple = true; const F = inp.files[0]; if (!F) return;
      const y = perde('<h2>Fotoğraf hazırlanıyor…</h2>', { kilitli: true });
      try {
        const h = await kucult(F);
        const yol = `/img/yuklenen/${def.klasor}/${slug(al.ad)}-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${Math.random().toString(36).slice(2, 6)}.jpg`;
        await alanKaydet(al, def, yol, [yol, h.blob]);
        D.onizleme[yol] = URL.createObjectURL(h.blob);
        y.remove(); p.remove(); bildir('Telefona kaydedildi — henüz sitede değil.', 3000); ciz();
      } catch (e) { y.remove(); hataPenceresi('Fotoğraf eklenemedi', e.message); }
    };
    inp.click();
  };
}

// Liste düzenleyici: maddeler, teknik özellikler, sık sorulan sorular. Her değişiklik anında taslağa kaydedilir.
function listeDuzenle(al, def, ilk) {
  let L = kopya(Array.isArray(ilk) ? ilk : []);
  const orijinal = kopya(yolAl(al.veri, def.yol)) || [];
  const p = perde('', { tam: true });
  const ozet = (o) => def.oge === 'metin' ? o : def.oge === 'cift' ? `${o.ad}: ${o.deger}` : def.oge === 'kart' ? (o[def.baslikAlan] || '') + (o.goster === false ? ' · gizli' : '') : o.soru;
  const kaydet = async (yeni, coklu = []) => {
    const hata = def.oge === 'kart' ? kartKorumaHatasi(orijinal, yeni) : korumaHatasi(orijinal, yeni);
    if (hata) { hataPenceresi('Kaydedilemedi', hata); return false; }
    try { await alanKaydet(al, def, yeni, null, coklu); } catch (e) { hataPenceresi('Kaydedilemedi', e.message); return false; }
    L = kopya(yeni); return true;
  };
  const ciz2 = () => {
    p.querySelector('.sayfa').innerHTML = `<div class="tutamak"></div><h2>${kacir(def.ad)}</h2>
      <div class="aciklama-not perde-not">Düzenlemek için dokunun. Sıra sitedeki sıradır.${def.ipucu ? ' ' + kacir(def.ipucu) : ''}</div>
      <ul class="liste oge-liste">${L.map((o, n) => `<li class="oge"><button class="oge-metin" data-n="${n}">${kacir(sade(ozet(o)) || '(boş)')}</button>
        <span class="oge-ok"><button data-yukari="${n}" ${n === 0 ? 'disabled' : ''} aria-label="Yukarı">↑</button><button data-asagi="${n}" ${n === L.length - 1 ? 'disabled' : ''} aria-label="Aşağı">↓</button></span></li>`).join('')}</ul>
      ${L.length ? '' : '<div class="aciklama-not">Henüz yok.</div>'}
      ${def.sabit ? '' : `<button class="dugme tam ara-bosluk" id="ekle">+ ${kacir(def.ogeAd)} ekle</button>`}
      ${bekleyenAlan(al, def) ? '<button class="dugme tam ara-bosluk" id="geri">Bu bölümdeki değişiklikleri geri al</button>' : ''}
      <button class="dugme ana tam ara-bosluk" id="bitti">Tamam</button>`;
    p.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => ogeDuzenle(+b.dataset.n));
    p.querySelectorAll('[data-yukari]').forEach((b) => b.onclick = async () => { const n = +b.dataset.yukari; const Y = kopya(L); [Y[n - 1], Y[n]] = [Y[n], Y[n - 1]]; if (await kaydet(Y)) ciz2(); });
    p.querySelectorAll('[data-asagi]').forEach((b) => b.onclick = async () => { const n = +b.dataset.asagi; const Y = kopya(L); [Y[n + 1], Y[n]] = [Y[n], Y[n + 1]]; if (await kaydet(Y)) ciz2(); });
    if ($('#ekle', p)) $('#ekle', p).onclick = () => ogeDuzenle(-1);
    if ($('#geri', p)) $('#geri', p).onclick = async () => { if (!confirm('Bu bölümdeki tüm değişiklikler geri alınsın mı?')) return; try { await alanGeriAl(al, def); } catch (e) { return hataPenceresi('Kaydedilemedi', e.message); } L = kopya(orijinal); ciz2(); };
    $('#bitti', p).onclick = () => { p.remove(); ciz(); };
  };
  const ogeDuzenle = (n) => {
    if (def.oge === 'kart') return kartDuzenle(n);
    const o = n >= 0 ? L[n] : (def.oge === 'metin' ? '' : def.oge === 'cift' ? { ad: '', deger: '' } : { soru: '', cevap: '', acik: false });
    const alanlar = def.oge === 'metin' ? [['_', def.ogeAd]] : def.oge === 'cift' ? def.alanlar : [['soru', 'Soru'], ['cevap', 'Cevap']];
    const deg = (k) => (k === '_' ? o : o[k]) || '';
    const f = perde(`<h2>${n >= 0 ? kacir(def.ogeAd) + ' düzenle' : 'Yeni ' + kacir(def.ogeAd.toLocaleLowerCase('tr'))}</h2>
      ${alanlar.map(([k, ad]) => `<label class="alan"><span>${kacir(ad)}</span>${k === 'cevap' || (def.oge === 'metin' && String(deg(k)).length > 60) ? `<textarea class="duz" rows="5" data-k="${k}">${kacir(deg(k))}</textarea>` : `<input class="duz" data-k="${k}" value="${kacir(deg(k))}">`}</label>`).join('')}
      ${degiskenler(metinleri(o).join(' ')).length ? '<div class="kilit-not">🔒 {{…}} otomatik fiyattır; değiştirmeyin.</div>' : ''}
      <div id="uy2"></div>
      <button class="dugme ana tam" id="tm">Kaydet</button>
      ${n >= 0 ? '<button class="dugme tehlike tam ara-bosluk" id="sil">Bunu kaldır</button>' : ''}
      <button class="dugme tam ara-bosluk" id="vz">Vazgeç</button>`, { tam: true });
    $('#vz', f).onclick = () => f.remove();
    $('#tm', f).onclick = async () => {
      const al2 = (k) => ($(`[data-k="${k}"]`, f).value || '').replace(/\r/g, '').trim();
      const yeniO = def.oge === 'metin' ? al2('_') : def.oge === 'cift' ? { ...o, ad: al2('ad'), deger: al2('deger') } : { ...o, soru: al2('soru'), cevap: al2('cevap') };
      const hata = bosHatasi(def, [yeniO]);
      if (hata) { $('#uy2', f).innerHTML = `<div class="hata-kutu bosluksuz">${kacir(hata)}</div>`; return; }
      const Y = kopya(L); if (n >= 0) Y[n] = yeniO; else Y.push(yeniO);
      if (await kaydet(Y)) { f.remove(); bildir('Telefona kaydedildi — henüz sitede değil'); ciz2(); }
    };
    if ($('#sil', f)) $('#sil', f).onclick = async () => {
      if (!confirm('Kaldırılsın mı? (Yayınlamadan önce geri alabilirsiniz.)')) return;
      const Y = kopya(L); Y.splice(n, 1);
      const hata = bosHatasi(def, Y); if (hata) { $('#uy2', f).innerHTML = `<div class="hata-kutu bosluksuz">${kacir(hata)}</div>`; return; }
      if (await kaydet(Y)) { f.remove(); ciz2(); }
    };
  };
  const kartDuzenle = (n) => {
    const o = n >= 0 ? kopya(L[n]) : Object.fromEntries(def.alanlar.map(([k, , t]) => [k, t === 'anahtar' ? true : '']));
    const yeniDosya = {}; // alan → [yol, blob]
    const f = perde('', { tam: true });
    const ciz3 = () => {
      f.querySelector('.sayfa').innerHTML = `<div class="tutamak"></div><h2>${n >= 0 ? kacir(def.ogeAd) + ' düzenle' : 'Yeni ' + kacir(def.ogeAd.toLocaleLowerCase('tr'))}</h2>
      ${def.alanlar.map(([k, ad, t]) => t === 'gorsel'
        ? `<div class="alan"><span>${kacir(ad)}</span>${o[k] ? `<img class="onizleme" src="${kacir(resimAdresi(o[k]))}" alt="">` : '<div class="aciklama-not">Fotoğraf yok.</div>'}<button class="dugme tam" data-foto="${k}">${o[k] ? 'Fotoğrafı değiştir' : 'Fotoğraf seç'}</button></div>`
        : t === 'anahtar' ? `<label class="anahtar"><input type="checkbox" data-k="${k}" ${o[k] !== false ? 'checked' : ''}><span>${kacir(ad)}</span></label>`
        : t === 'uzun' ? `<label class="alan"><span>${kacir(ad)}</span><textarea class="duz" rows="3" data-k="${k}">${kacir(o[k] || '')}</textarea></label>`
        : `<label class="alan"><span>${kacir(ad)}</span><input class="duz" data-k="${k}" value="${kacir(o[k] || '')}" ${t === 'adres' ? 'inputmode="url" autocapitalize="off"' : ''}></label>`).join('')}
      ${degiskenler(metinleri(o).join(' ')).length ? '<div class="kilit-not">🔒 {{…}} otomatik fiyattır; değiştirmeyin. Çevresindeki yazıyı düzenleyebilirsiniz.</div>' : ''}
      <div id="uy3"></div>
      <button class="dugme ana tam" id="tm">Kaydet</button>
      ${n >= 0 && !def.sabit ? '<button class="dugme tehlike tam ara-bosluk" id="sil">Bunu kaldır</button>' : ''}
      <button class="dugme tam ara-bosluk" id="vz">Vazgeç</button>`;
      const oku = () => { f.querySelectorAll('[data-k]').forEach((e) => { o[e.dataset.k] = e.type === 'checkbox' ? e.checked : e.value.replace(/\r/g, '').trim(); }); };
      f.querySelectorAll('[data-foto]').forEach((b) => b.onclick = () => {
        oku(); const k = b.dataset.foto;
        const inp = $('#dosya'); inp.value = ''; inp.multiple = false;
        inp.onchange = async () => {
          inp.multiple = true; const F = inp.files[0]; if (!F) return;
          const y = perde('<h2>Fotoğraf hazırlanıyor…</h2>', { kilitli: true });
          try {
            const h = await kucult(F);
            const yol = `/img/yuklenen/anasayfa/${slug(o[def.baslikAlan] || def.ogeAd)}-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${Math.random().toString(36).slice(2, 6)}.jpg`;
            yeniDosya[k] = [yol, h.blob]; o[k] = yol; D.onizleme[yol] = URL.createObjectURL(h.blob);
          } catch (e) { hataPenceresi('Fotoğraf eklenemedi', e.message); }
          y.remove(); ciz3();
        };
        inp.click();
      });
      $('#vz', f).onclick = () => f.remove();
      $('#tm', f).onclick = async () => {
        oku();
        const hata = bosHatasi(def, [o]);
        if (hata) { $('#uy3', f).innerHTML = `<div class="hata-kutu bosluksuz">${kacir(hata)}</div>`; return; }
        const Y = kopya(L); if (n >= 0) Y[n] = kopya(o); else Y.push(kopya(o));
        if (await kaydet(Y, Object.values(yeniDosya))) { f.remove(); bildir('Telefona kaydedildi — henüz sitede değil'); ciz2(); }
      };
      if ($('#sil', f)) $('#sil', f).onclick = async () => {
        if (!confirm('Kaldırılsın mı? (Yayınlamadan önce geri alabilirsiniz.)')) return;
        const Y = kopya(L); Y.splice(n, 1);
        if (await kaydet(Y)) { f.remove(); ciz2(); }
      };
    };
    ciz3();
  };
  ciz2();
}

// Kart listelerinde (öne çıkanlar vb.) kart silinebilir; yalnızca yeni/uydurma fiyat işareti eklenemez ve işaretler bozulamaz.
function kartKorumaHatasi(eski, yeni) {
  const E = metinleri(eski).join('\n'), Y = metinleri(yeni).join('\n');
  if (/\{\{|\}\}/.test(Y.replace(FIYAT_TOK, ''))) return 'Otomatik fiyat işareti ({{…}}) bozulmuş.';
  const bilinen = new Set(degiskenler(E));
  const yabanci = degiskenler(Y).filter((v) => !bilinen.has(v));
  if (yabanci.length) return 'Otomatik fiyat işaretleri buradan eklenemez: ' + [...new Set(yabanci)].join(', ');
  for (const t of metinleri(yeni)) if (((t.match(/\*\*/g) || []).length) % 2) return 'Kalın yazı işareti (**) eksik kalmış.';
  return '';
}

function metinDegisikligiOzeti(i) {
  const al = D.albumler.find((a) => a.id === i.album);
  const def = al && alanBul(al.tur, i.yol);
  const ad = def ? def.ad : i.yol.join(' › ');
  const fiyat = /\{\{/.test(metinleri([i.eski, i.yeni]).join(' ')) ? ' <span class="rozet">fiyat içeriyor</span>' : '';
  if (i.tur === 'liste') return `${kacir(ad)}: ${(i.eski || []).length} → ${(i.yeni || []).length} öğe${fiyat}`;
  if (typeof i.yeni === 'boolean') return `${kacir(ad)}: ${i.yeni ? 'açıldı' : 'kapatıldı'}`;
  if (def && def.tip === 'gorsel') return `${kacir(ad)}: yeni fotoğraf <img class="ozet-kucuk" src="${kacir(resimAdresi(i.yeni))}" alt="">`;
  const k = (s) => { s = sade(s); return s.length > 50 ? s.slice(0, 50) + '…' : s; };
  return `${kacir(ad)}: <s>${kacir(k(i.eski) || 'boş')}</s> → ${kacir(k(i.yeni) || 'boş')}${fiyat}`;
}

// ---------- el yazımı HTML sayfalar (Hakkımızda, Kurumsal, semtler, rehberler) ----------
// Her düzenlenebilir öğe kaynakta kalıcı bir kimlik taşır: data-y="yN". Değişiklik yalnızca o öğenin iç kısmına,
// ham kaynak metinde uygulanır (DOM'a çevirip yeniden yazma yok); dosyanın geri kalanı bayt bayt korunur.
const SEMT_AD = { atasehir: 'Ataşehir', bebek: 'Bebek', besiktas: 'Beşiktaş', etiler: 'Etiler', kadikoy: 'Kadıköy', levent: 'Levent', nisantasi: 'Nişantaşı', sisli: 'Şişli' };
const REHBER_AD = { 'baski-dosyasi-hazirlama': 'Baskı dosyası hazırlama', 'branda-mi-mesh-mi': 'Branda mı, mesh mi?', 'cam-filmi-secimi': 'Cam filmi seçimi', 'fotoblok-foreks-baski': 'Fotoblok (foreks) baskı', 'fuar-ve-etkinlik-baski-listesi': 'Fuar ve etkinlik baskı listesi', 'ofis-cam-filmi-fiyati': 'Ofis cam filmi fiyatı', 'sticker-olcu-ve-kesim-payi': 'Sticker ölçüsü ve kesim payı' };
const guzelAd = (slug) => slug.split('-').map((w, n) => (n ? w : w.charAt(0).toLocaleUpperCase('tr') + w.slice(1))).join(' ');
function htmlAlbumleri(hi, hr) {
  const A = [];
  A.push({ id: 'html:site/index.html', tur: 'html', grup: 'ana', ad: 'Anasayfa — diğer bölümler', aciklama: 'Ürün ve hizmet kutuları, bölüm yazıları ve fotoğraflar', dosya: 'site/index.html', alan: null, sayfa: '/', veri: null, oid: null, googleYok: true });
  const ekle = (dosya, ad, grup, aciklama) => A.push({ id: 'html:' + dosya, tur: 'html', grup, ad, aciklama, dosya, alan: null, sayfa: '/' + dosya.replace(/^site\//, '').replace(/index\.html$/, ''), veri: null, oid: null });
  ekle('site/hakkimizda/index.html', 'Hakkımızda', 'bilgi', 'Bilgi sayfası');
  ekle('site/kurumsal/index.html', 'Kurumsal', 'bilgi', 'Bilgi sayfası');
  ekle('site/istanbul/index.html', 'İstanbul (semtler ana sayfası)', 'semt', 'Semt sayfaları girişi');
  for (const e of (hi || [])) if (e.type === 'tree' && /^[a-z0-9-]+$/.test(e.name)) { const k = e.name.replace(/-dijital-baski$/, ''); ekle(`site/istanbul/${e.name}/index.html`, SEMT_AD[k] || guzelAd(k), 'semt', 'Semt sayfası'); }
  ekle('site/rehber/index.html', 'Rehber (ana sayfa)', 'rehber', 'Rehber yazıları girişi');
  for (const e of (hr || [])) if (e.type === 'tree' && /^[a-z0-9-]+$/.test(e.name)) ekle(`site/rehber/${e.name}/index.html`, REHBER_AD[e.name] || guzelAd(e.name), 'rehber', 'Rehber yazısı');
  return A;
}
async function sayfaOku(sha, dosya) {
  const j = await gh('/sayfa', 'POST', { sha, dosya });
  const d = j && j.data && j.data.repository && j.data.repository.d;
  if (!d || typeof d.text !== 'string') throw new Error('Sayfa okunamadı: ' + dosya);
  return d;
}
const HTML_IZINLI = /^(?:[^<]|<(?:strong|b)>|<\/(?:strong|b)>|<br\s*\/?>|<a\s+href="[^"<>]*"(?:\s+(?:target|rel)="[^"<>]*")*>|<\/a>)*$/;
const HTML_ETIKET_AD = { h1: 'Sayfa başlığı', h2: 'Ara başlık', h3: 'Küçük başlık', p: 'Paragraf', li: 'Madde' };
function htmlOgeleri(src) {
  // Yalnızca <main> içindeki öğeler (tek <main> şartı); dışarıdaki aynı kimliklere dokunulmaz.
  const m0 = src.indexOf('<main'), m1 = src.indexOf('</main>');
  if (m0 < 0 || m1 < m0 || src.indexOf('<main', m0 + 1) >= 0) return [];
  const bolum = src.slice(m0, m1);
  const re = /<(h1|h2|h3|p|li)\b([^<>]*?)\sdata-y="(y\d+)"([^<>]*)>([\s\S]*?)<\/\1>/g; const L = []; let m;
  while ((m = re.exec(bolum))) {
    const bas = m0 + m.index + m[0].indexOf('>') + 1;
    L.push({ etiket: m[1], anahtar: m[3], bas, son: bas + m[5].length, ic: m[5], duzenlenir: HTML_IZINLI.test(m[5]) });
  }
  return L;
}
// <main> içindeki data-g kimlikli görseller
function htmlGorselleri(src) {
  const m0 = src.indexOf('<main'), m1 = src.indexOf('</main>');
  if (m0 < 0 || m1 < m0 || src.indexOf('<main', m0 + 1) >= 0) return [];
  const L = []; const re = /<img\s[^<>]*?\sdata-g="(g\d+)"[^<>]*>/g; let m; const bolum = src.slice(m0, m1);
  while ((m = re.exec(bolum))) {
    const t = m[0]; const a = (k) => { const x = t.match(new RegExp('\\s' + k + '="([^"]*)"')); return x ? entCoz(x[1]) : null; };
    L.push({ tur: 'gorsel', anahtar: m[1], bas: m0 + m.index, son: m0 + m.index + t.length, etiket: t, src: a('src'), alt: a('alt') || '' });
  }
  return L;
}
function htmlGorsel(src, anahtar) { const L = htmlGorselleri(src).filter((x) => x.anahtar === anahtar); return L.length === 1 ? L[0] : null; }
const BOLUM_AD = { urunler: 'Ürünler bölümü', hizmetler: 'Hizmetler bölümü', projeler: 'Projeler', sss: 'Sık sorulan sorular' };
function bolumAdi(src, konum) {
  let ad = 'Üst bölüm'; const re = /<section[^>]*\sid="([^"]+)"/g; let m;
  while ((m = re.exec(src)) && m.index < konum) ad = BOLUM_AD[m[1]] || m[1];
  return ad;
}
function htmlOge(src, anahtar) {
  const L = htmlOgeleri(src).filter((x) => x.anahtar === anahtar);
  return L.length === 1 ? L[0] : null; // kimlik tekil değilse dokunulmaz
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const entCoz = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (t, k) => (k[0] === '#' ? String.fromCodePoint(k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)) : (ENT[k.toLowerCase()] ?? t)));
const entKac = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Ham iç HTML → düzenleyici metni (**kalın**, [yazı](adres), satır sonu)
function htmlDenMetin(ic) {
  return entCoz(ic.replace(/<br\s*\/?>/g, '\n').replace(/<\/?(?:strong|b)>/g, '**').replace(/<a\s+href="([^"<>]*)"[^<>]*>([\s\S]*?)<\/a>/g, (t, h, y) => `[${y}](${entCoz(h)})`)).trim();
}
// Düzenleyici metni → ham iç HTML. Bağlantıların açılış etiketi (target/rel dahil) eski içerikten aynen alınır.
function metindenHtml(metin, eskiIc) {
  const acilis = {}; for (const m of (eskiIc || '').matchAll(/(<a\s+href="([^"<>]*)"[^<>]*>)/g)) acilis[entCoz(m[2])] = m[1];
  const parcalar = []; let son = 0;
  for (const m of metin.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    parcalar.push(entKac(metin.slice(son, m.index)));
    parcalar.push((acilis[m[2]] || `<a href="${entKac(m[2]).replace(/"/g, '&quot;')}">`) + entKac(m[1]) + '</a>');
    son = m.index + m[0].length;
  }
  parcalar.push(entKac(metin.slice(son)));
  let h = parcalar.join('');
  let acik = false; h = h.replace(/\*\*/g, () => ((acik = !acik) ? '<strong>' : '</strong>'));
  return h.replace(/\n/g, '<br>');
}
// <title> ve meta açıklama; og: karşılıkları yalnızca önceden aynıysa birlikte güncellenir.
const META = { title: { ad: 'Google başlığı', seo: 'baslik', zorunlu: true }, description: { ad: 'Google açıklaması', seo: 'aciklama' } };
function metaAl(src, k) {
  if (k === 'title') { const m = src.match(/<title>([\s\S]*?)<\/title>/); return m ? entCoz(m[1]) : null; }
  const m = src.match(/<meta name="description" content="([^"]*)"/); return m ? entCoz(m[1]) : null;
}
function metaSayisi(src, k) { return (src.match(k === 'title' ? /<title>[\s\S]*?<\/title>/g : /<meta name="description" content="[^"]*"/g) || []).length; }
function metaKoy(src, k, eski, yeni) {
  if (metaSayisi(src, k) !== 1) throw new Error('Sayfanın Google ' + (k === 'title' ? 'başlığı' : 'açıklaması') + ' güvenle bulunamadı; değişiklik uygulanmadı.');
  const a = (v) => entKac(v).replace(/"/g, '&quot;');
  if (k === 'title') {
    src = src.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${entKac(yeni)}</title>`);
    for (const p of ['og:title', 'twitter:title']) src = src.replace(new RegExp(`(<meta (?:property|name)="${p}" content=")([^"]*)(")`), (t, b, v, s2) => (entCoz(v) === eski ? b + a(yeni) + s2 : t));
  } else {
    src = src.replace(/(<meta name="description" content=")([^"]*)(")/, (t, b, v, s2) => b + a(yeni) + s2);
    for (const p of ['og:description', 'twitter:description']) src = src.replace(new RegExp(`(<meta (?:property|name)="${p}" content=")([^"]*)(")`), (t, b, v, s2) => (entCoz(v) === eski ? b + a(yeni) + s2 : t));
  }
  return src;
}
// HTML işlemi: {tur:'html', album, anahtar ('yN' | 'title' | 'description'), eski (ham), yeni (ham)}
function htmlUygula(al, i, siki) {
  const src = al.veri.kaynak;
  if (i.anahtar === 'title' || i.anahtar === 'description') {
    const mevcut = metaAl(src, i.anahtar);
    if (siki && mevcut !== i.eski) throw Object.assign(new Error('Bu bölüm siz düzenlerken başka yerden değiştirilmiş.'), { islem: i, cakisma: true, mevcut });
    try { al.veri.kaynak = metaKoy(src, i.anahtar, mevcut, i.yeni); } catch (e) { if (siki) throw Object.assign(e, { islem: i }); }
    return;
  }
  if (/^g\d+$/.test(i.anahtar)) {
    const g = htmlGorsel(src, i.anahtar);
    if (!g) { if (siki) throw Object.assign(new Error('Bu fotoğraf sayfada artık bulunamıyor.'), { islem: i }); return; }
    if (g.src !== i.eski.src || g.alt !== i.eski.alt) { if (siki) throw Object.assign(new Error('Bu fotoğraf siz düzenlerken başka yerden değiştirilmiş.'), { islem: i, cakisma: true, mevcut: g.alt }); return; }
    if (siki && !/^\/img\/[A-Za-z0-9._\/-]+\.(?:webp|jpe?g|png)$/.test(i.yeni.src)) throw Object.assign(new Error('Fotoğraf adresi geçersiz.'), { islem: i });
    const ak = (v) => entKac(v).replace(/"/g, '&quot;');
    let t = g.etiket.replace(/(\ssrc=")[^"]*(")/, (x, a, b) => a + ak(i.yeni.src) + b);
    t = /\salt="/.test(t) ? t.replace(/(\salt=")[^"]*(")/, (x, a, b) => a + ak(i.yeni.alt) + b) : t.replace(/^<img/, '<img alt="' + ak(i.yeni.alt) + '"');
    if (siki && !t.includes('src="' + ak(i.yeni.src) + '"')) throw Object.assign(new Error('Fotoğraf sayfaya yazılamadı.'), { islem: i });
    if (i.yeni.w && i.yeni.h) t = t.replace(/(\swidth=")\d+(")/, (x, a, b) => a + i.yeni.w + b).replace(/(\sheight=")\d+(")/, (x, a, b) => a + i.yeni.h + b);
    al.veri.kaynak = src.slice(0, g.bas) + t + src.slice(g.son); return;
  }
  const o = htmlOge(src, i.anahtar);
  if (!o) { if (siki) throw Object.assign(new Error('Bu yazı sayfada artık bulunamıyor.'), { islem: i }); return; }
  if (o.ic !== i.eski) { if (siki) throw Object.assign(new Error('Bu bölüm siz düzenlerken başka yerden değiştirilmiş.'), { islem: i, cakisma: true, mevcut: htmlDenMetin(o.ic) }); return; }
  if (siki) { const h = korumaHatasi(htmlDenMetin(i.eski), htmlDenMetin(i.yeni)); if (h) throw Object.assign(new Error(h), { islem: i }); if (!HTML_IZINLI.test(i.yeni)) throw Object.assign(new Error('Yazıda izin verilmeyen biçim var.'), { islem: i }); }
  al.veri.kaynak = src.slice(0, o.bas) + i.yeni + src.slice(o.son);
}

async function htmlYukle(al) {
  if (al.veri) return true;
  yukleniyorEkrani('Sayfa açılıyor…');
  try { const d = await sayfaOku(D.sha, al.dosya); al.veri = { kaynak: d.text }; al.oid = d.oid; return true; }
  catch (e) { if (!e.oturum) hataPenceresi('Sayfa açılamadı', e.message); return false; }
}
function htmlEkrani(al) {
  if (!al.veri) { htmlYukle(al).then((ok) => (ok ? ciz() : git({ ad: 'ana' }, true))); return; }
  const g = gorunenAlbum(al); const src = g.veri.kaynak;
  const sekme = D.ekran.sekme === 'google' && !al.googleYok ? 'google' : 'metin';
  const bekleyen = new Set(D.islemler.filter((i) => i.album === al.id).map((i) => i.anahtar));
  let govde;
  if (sekme === 'metin') {
    const L = [...htmlOgeleri(src), ...htmlGorselleri(src)].sort((a, b) => a.bas - b.bas);
    let sonBolum = null; const parca = [];
    for (const o of L) {
      const bl = al.dosya === 'site/index.html' ? bolumAdi(src, o.bas) : null;
      if (bl && bl !== sonBolum) { parca.push(`</ul><div class="bolum">${kacir(bl)}</div><ul class="liste kartlar">`); sonBolum = bl; }
      if (o.tur === 'gorsel') parca.push(`<li><button class="metin-kart gorsel-kart" data-anahtar="${o.anahtar}"><img src="${kacir(resimAdresi(o.src))}" alt=""><span><span class="mk-ad">Fotoğraf${bekleyen.has(o.anahtar) ? ' <span class="rozet">değişti</span>' : ''}</span><span class="mk-deger">${kacir(o.alt || 'Açıklama yok')}</span></span></button></li>`);
      else parca.push(`<li><button class="metin-kart ${o.duzenlenir ? '' : 'soluk'}" data-anahtar="${o.anahtar}" ${o.duzenlenir ? '' : 'disabled'}>
        <span class="mk-ad">${HTML_ETIKET_AD[o.etiket]}${bekleyen.has(o.anahtar) ? ' <span class="rozet">değişti</span>' : ''}${o.duzenlenir ? '' : ' · sabit tasarım öğesi, buradan değişmez'}</span>
        <span class="mk-deger">${kacir(sade(htmlDenMetin(o.ic)))}</span></button></li>`);
    }
    govde = `<div class="aciklama-not">Sayfadaki yazı ve fotoğraflar sırayla. Değiştirmek için dokunun. Tasarım ve menü buradan değişmez.${al.dosya === 'site/index.html' ? ' Üst başlık, sipariş düğmeleri, öne çıkanlar, ne yapıyoruz kartları, referanslar, kısa hakkımızda ve SSS “Anasayfa yazıları”nda; proje kategorileri “Projelerimiz ve referanslarımız” bölümündedir.' : ''}</div>
      <ul class="liste kartlar">${parca.join('')}</ul>`;
  } else {
    const t = metaAl(src, 'title') || '', d = metaAl(src, 'description') || '';
    govde = `<div class="g-onizleme"><div class="g-site">IstanbulPrintLab</div><div class="g-adres">istanbulprintlab.com${kacir(al.sayfa === '/' ? '' : ' › ' + al.sayfa.replace(/^\/|\/$/g, '').split('/').join(' › '))}</div>
      <div class="g-baslik">${kacir(t)}</div><div class="g-aciklama">${kacir(d)}</div></div>
      <div class="aciklama-not">Yaklaşık görünüm. Google başlığı ve açıklamayı farklı gösterebilir.</div>
      <ul class="liste kartlar">${['title', 'description'].map((k) => `<li><button class="metin-kart" data-anahtar="${k}"><span class="mk-ad">${META[k].ad}${bekleyen.has(k) ? ' <span class="rozet">değişti</span>' : ''}</span><span class="mk-deger">${kacir(metaAl(src, k) || 'Boş')}</span></button></li>`).join('')}</ul>`;
  }
  kok.innerHTML = `<div class="ust"><button class="geri" id="geri" aria-label="Geri">‹</button><h1>${kacir(al.ad)}</h1>
      <a class="dugme ust-baglanti" href="${kacir(siteYolu(al.sayfa))}" target="_blank" rel="noopener">Sayfayı aç</a></div>
    <div class="sekmeler" role="tablist">${(al.googleYok ? [['metin', 'Yazılar ve fotoğraflar']] : [['metin', 'Metinler'], ['google', 'Google']]).map(([k, ad]) => `<button role="tab" data-sekme="${k}" class="${k === sekme ? 'secili' : ''}">${ad}</button>`).join('')}</div>${govde}`;
  $('#geri').onclick = () => history.back();
  kok.querySelectorAll('[data-sekme]').forEach((b) => b.onclick = () => { D.ekran = { ...D.ekran, sekme: b.dataset.sekme }; history.replaceState(D.ekran, ''); ciz(); });
  kok.querySelectorAll('[data-anahtar]').forEach((b) => b.onclick = () => (/^g\d+$/.test(b.dataset.anahtar) ? htmlGorselDuzenle(al, b.dataset.anahtar) : htmlDuzenle(al, b.dataset.anahtar)));
  yayinCubugu();
}
function htmlDuzenle(al, anahtar, baslangic) {
  const g = gorunenAlbum(al); const meta = META[anahtar];
  const oGor = meta ? null : htmlOge(g.veri.kaynak, anahtar);
  const oAsil = meta ? null : htmlOge(al.veri.kaynak, anahtar);
  if (!meta && (!oGor || !oAsil || !oAsil.duzenlenir)) return hataPenceresi('Düzenlenemiyor', 'Bu yazı bu sayfada güvenle bulunamadı.');
  if (meta && metaSayisi(al.veri.kaynak, anahtar) !== 1) return hataPenceresi('Düzenlenemiyor', 'Bu sayfanın Google alanı güvenle bulunamadı.');
  const eskiHam = meta ? metaAl(al.veri.kaynak, anahtar) : oAsil.ic; // sitedeki hal
  const eskiMetin = meta ? eskiHam : htmlDenMetin(eskiHam);
  const ilk = baslangic !== undefined ? baslangic : (meta ? metaAl(g.veri.kaynak, anahtar) : htmlDenMetin(oGor.ic));
  const def = meta ? { ad: meta.ad, tip: anahtar === 'title' ? 'satir' : 'paragraf', zorunlu: meta.zorunlu, seo: meta.seo } : { ad: HTML_ETIKET_AD[oAsil.etiket], tip: oAsil.etiket === 'p' || oAsil.etiket === 'li' ? 'paragraf' : 'satir', zorunlu: true };
  const bekliyor = D.islemler.some((i) => i.album === al.id && i.anahtar === anahtar);
  const p = perde(`<h2>${kacir(def.ad)}</h2>
    ${def.tip === 'satir' ? `<input class="duz" id="dg" value="${kacir(ilk)}">` : `<textarea class="duz" id="dg" rows="7">${kacir(ilk)}</textarea>`}
    <div class="sayac" id="sy"></div>
    ${degiskenler(String(ilk || '')).length ? `<div class="kilit-not">🔒 ${kacir(degiskenler(String(ilk)).join(', '))} otomatik fiyattır; değiştirmeyin.</div>` : ''}
    ${/\*\*|\]\(/.test(String(ilk || '')) ? '<div class="aciklama-not perde-not">** arasındaki yazı kalın görünür. [yazı](adres) bir bağlantıdır: yazısını değiştirebilirsiniz, adresini değil.</div>' : ''}
    <div id="uy"></div>
    <button class="dugme ana tam" id="kaydet">Kaydet</button>
    ${bekliyor ? '<button class="dugme tam ara-bosluk" id="geri2">Bu değişikliği geri al (sitedeki hale dön)</button>' : ''}
    <button class="dugme tam ara-bosluk" id="vazgec">Vazgeç</button>`, { tam: true });
  const k = $('#dg', p);
  const oku = () => k.value.replace(/\r/g, '').replace(def.tip === 'satir' ? /\n/g : /$^/, ' ');
  const guncelle = () => { const v = oku(); $('#sy', p).textContent = v.trim().length + ' karakter'; const U = def.seo ? seoUyarilari(al, def, v) : []; $('#uy', p).innerHTML = U.map((u) => `<div class="uyari">${kacir(u)}</div>`).join(''); };
  k.oninput = guncelle; guncelle();
  $('#vazgec', p).onclick = () => p.remove();
  const yaz = async (L) => { try { await taslakYaz(L); return true; } catch (e) { hataPenceresi('Kaydedilemedi', e.message); return false; } };
  if ($('#geri2', p)) $('#geri2', p).onclick = async () => { if (await yaz(D.islemler.filter((i) => !(i.album === al.id && i.anahtar === anahtar)))) { p.remove(); bildir('Değişiklik geri alındı'); ciz(); } };
  $('#kaydet', p).onclick = async () => {
    const v = oku().trim();
    const hata = bosHatasi(def, v) || korumaHatasi(eskiMetin, v);
    if (hata) { $('#uy', p).innerHTML = `<div class="hata-kutu bosluksuz">${kacir(hata)}</div>`; return; }
    const yeniHam = meta ? v : metindenHtml(v, eskiHam);
    if (!meta && !HTML_IZINLI.test(yeniHam)) { $('#uy', p).innerHTML = '<div class="hata-kutu bosluksuz">Yazıda izin verilmeyen biçim var.</div>'; return; }
    const kalan = D.islemler.filter((i) => !(i.album === al.id && i.anahtar === anahtar));
    const degismedi = meta ? v === eskiHam : (v === eskiMetin || yeniHam === eskiHam);
    if (!(await yaz(degismedi ? kalan : [...kalan, { tur: 'html', album: al.id, anahtar, eski: eskiHam, yeni: yeniHam }]))) return;
    p.remove(); bildir('Telefona kaydedildi — henüz sitede değil. Hazır olunca “Yayınla”ya basın.', 3500); ciz();
  };
}
function htmlGorselDuzenle(al, anahtar) {
  const g = gorunenAlbum(al); const gGor = htmlGorsel(g.veri.kaynak, anahtar); const gAsil = htmlGorsel(al.veri.kaynak, anahtar);
  if (!gGor || !gAsil) return hataPenceresi('Düzenlenemiyor', 'Bu fotoğraf sayfada güvenle bulunamadı.');
  const onceki = D.islemler.find((i) => i.album === al.id && i.anahtar === anahtar);
  let yeni = { src: gGor.src, alt: gGor.alt }; let dosya = null;
  const p = perde(`<h2>Fotoğraf</h2>
    <img class="onizleme" id="oz" src="${kacir(resimAdresi(gGor.src))}" alt="">
    <button class="dugme tam" id="degistir">Fotoğrafı değiştir</button>
    <label class="alan"><span>Fotoğrafta ne var? (Google ve görme engelli ziyaretçiler için)</span><input class="duz" id="alt" value="${kacir(gGor.alt)}"></label>
    <div id="uy"></div>
    <button class="dugme ana tam" id="kaydet">Kaydet</button>
    ${onceki ? '<button class="dugme tam ara-bosluk" id="geri2">Sitedeki hale dön</button>' : ''}
    <button class="dugme tam ara-bosluk" id="vazgec">Vazgeç</button>`, { tam: true });
  $('#vazgec', p).onclick = () => p.remove();
  const yaz = async (L, ek) => { try { await taslakYaz(L, ek); return true; } catch (e) { hataPenceresi('Kaydedilemedi', e.message); return false; } };
  if ($('#geri2', p)) $('#geri2', p).onclick = async () => { if (await yaz(D.islemler.filter((i) => i !== onceki), { dosyaSil: onceki.dosya ? [onceki.dosya] : [] })) { p.remove(); ciz(); } };
  $('#degistir', p).onclick = () => {
    const inp = $('#dosya'); inp.value = ''; inp.multiple = false;
    inp.onchange = async () => {
      inp.multiple = true; const F = inp.files[0]; if (!F) return;
      try {
        const h = await kucult(F);
        const yol = `/img/yuklenen/sayfalar/${slug(al.ad)}-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${Math.random().toString(36).slice(2, 6)}.jpg`;
        dosya = [yol, h.blob]; yeni = { ...yeni, src: yol, w: h.w, h: h.h };
        D.onizleme[yol] = URL.createObjectURL(h.blob); $('#oz', p).src = D.onizleme[yol];
      } catch (e) { hataPenceresi('Fotoğraf eklenemedi', e.message); }
    };
    inp.click();
  };
  $('#kaydet', p).onclick = async () => {
    yeni.alt = $('#alt', p).value.trim().replace(/[<>]/g, '');
    if (!yeni.alt) { $('#uy', p).innerHTML = '<div class="hata-kutu bosluksuz">Fotoğrafın kısa açıklamasını yazın.</div>'; return; }
    const eski = { src: gAsil.src, alt: gAsil.alt };
    const kalan = D.islemler.filter((i) => i !== onceki);
    const degismedi = yeni.src === eski.src && yeni.alt === eski.alt;
    const op = { tur: 'html', album: al.id, anahtar, eski, yeni, ...(dosya ? { dosya: dosya[0] } : onceki && onceki.dosya && onceki.yeni.src === yeni.src ? { dosya: onceki.dosya } : {}) };
    if (!(await yaz(degismedi ? kalan : [...kalan, op], { dosyaEkle: dosya ? [dosya] : [], dosyaSil: onceki && onceki.dosya && onceki.dosya !== op.dosya ? [onceki.dosya] : [] }))) return;
    p.remove(); bildir('Telefona kaydedildi — henüz sitede değil.', 3000); ciz();
  };
}
function htmlDegisikligiOzeti(i) {
  if (/^g\d+$/.test(i.anahtar)) return `Fotoğraf${i.yeni.src !== i.eski.src ? `: yeni fotoğraf <img class="ozet-kucuk" src="${kacir(resimAdresi(i.yeni.src))}" alt="">` : ': açıklama değişti'}`;
  const al = D.albumler.find((a) => a.id === i.album);
  let ad = META[i.anahtar] ? META[i.anahtar].ad : 'Yazı';
  if (!META[i.anahtar] && al && al.veri) { const o = htmlOge(al.veri.kaynak, i.anahtar); if (o) ad = HTML_ETIKET_AD[o.etiket]; }
  const k = (s) => { s = sade(META[i.anahtar] ? s : htmlDenMetin(s)); return s.length > 50 ? s.slice(0, 50) + '…' : s; };
  return `${kacir(ad)}: <s>${kacir(k(i.eski) || 'boş')}</s> → ${kacir(k(i.yeni) || 'boş')}`;
}

// ---------- iletişim bilgileri ----------
const ILETISIM_ALANLARI = [
  { yol: ['telefon'], ad: 'Telefon (WhatsApp da bu numara)', tip: 'satir', zorunlu: true, tekrar: true, ipucu: 'Örn. +90 532 523 73 64. Sitedeki bütün arama ve WhatsApp düğmeleri bu numaraya bağlanır.',
    dogrula: (v) => { const d = v.replace(/\D/g, '').replace(/^0090/, '90').replace(/^0/, '90'); const t = d.startsWith('90') ? d : '90' + d; return /^90[2-5]\d{9}$/.test(t) ? '' : 'Geçerli bir Türkiye telefon numarası yazın (ör. +90 532 523 73 64).'; } },
  { yol: ['eposta'], ad: 'E-posta', tip: 'satir', zorunlu: true, tekrar: true, ipucu: 'Teklif formları ve sitedeki e-posta bağlantıları.',
    dogrula: (v) => (/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(v) ? '' : 'Geçerli bir e-posta adresi yazın.') },
  { yol: ['adres'], ad: 'Açık adres', tip: 'satir', zorunlu: true, ipucu: 'Mahalle, sokak, numara. İlçe ayrı yazılır.', dogrula: (v) => (v.length > 120 ? 'Adres 120 karakteri geçmesin.' : /[<>"]/.test(v) ? 'Adreste < > " karakterleri kullanılamaz.' : '') },
  { yol: ['ilce'], ad: 'İlçe', tip: 'satir', zorunlu: true, dogrula: (v) => (/^[A-Za-zÇĞİÖŞÜçğıöşü .-]{2,30}$/.test(v) ? '' : 'Yalnızca ilçe adını yazın (ör. Kadıköy).') },
];

// ---------- fiyatlar ----------
// Her fiyatın birimi ve KDV türü sabittir; kullanıcı değiştiremez (build.py'deki KDV_DAHIL ve ARALIK ile aynı).
const FIYAT_GRUPLARI = [
  { ad: 'Metrekare fiyatları', not: 'KDV hariç girilir', kdv: 'haric', toplu: true, varsayilan: true, kalemler: [['cam_filmi', 'Ofis cam filmi', 'm²']] },
  { ad: 'Adet fiyatları', not: 'KDV hariç girilir', kdv: 'haric', toplu: true, kalemler: [['rollup', 'Roll-up 85×200', 'adet']] },
  { ad: 'Başlangıç fiyatları', not: 'KDV hariç girilir · sitede "…den başlayan" diye geçer', kdv: 'haric', toplu: true, kalemler: [['dekupe', 'Dekupe figür', 'başlangıç'], ['duvar_kagidi', 'Duvar kağıdı', 'başlangıç']] },
  { ad: '2027 takvim', not: 'KDV DAHİL girilir', kdv: 'dahil', toplu: true, kalemler: [['takvim', 'Takvim poster', 'adet'], ['takvim_cerceveli', 'Takvim, çerçeveli', 'adet'], ['takvim_50', 'Takvim toplu, 50+ adet', 'adet başı'], ['takvim_100', 'Takvim toplu, 100+ adet', 'adet başı']] },
];
const FIYAT_ARALIK = { asgari: [0, 20000], kargo_esik: [0, 200000], rollup: [500, 50000] };
const fiyatAralik = (k) => FIYAT_ARALIK[k] || [50, 30000];
const KDV = 0.20; // sitedeki hesaplayıcılar ve {{x+kdv}} ile aynı oran (build.py: ×1.2)
const tl = (n) => Math.round(n).toLocaleString('tr-TR') + ' ₺';
const yuzde = (e, y) => (e ? ((y - e) * 100 / e) : 0);
const yuzdeYaz = (p) => (p > 0 ? '+' : '') + p.toFixed(1).replace('.', ',') + '%';
function fiyatKalemi(k) { for (const g of FIYAT_GRUPLARI) for (const [a, ad, birim] of g.kalemler) if (a === k) return { k, ad, birim, grup: g }; return null; }
function fiyatKullanim(k) {
  const re = new RegExp('\\{\\{' + k + '(?:\\*[\\d.]+)?(?:\\+kdv|:ham)?\\}\\}', 'g'); let n = 0; const yerler = new Set();
  for (const a of D.albumler) { if (a.tur === 'fiyatlar') continue; const c = (JSON.stringify(a.veri).match(re) || []).length; if (c) { n += c; yerler.add(a.ad); } }
  return { n, yerler: [...yerler] };
}
const fiyatAlbum = () => D.albumler.find((a) => a.id === 'fiyatlar');
const karsilik = (g, v) => g.kdv === 'haric' ? `KDV (%20) dahil ${tl(v * (1 + KDV))}` : g.kdv === 'dahil' ? `KDV (%20) hariç ${tl(v / (1 + KDV))}` : '';

function fiyatlarEkrani() {
  const al = fiyatAlbum(); const g = gorunenAlbum(al);
  const satir = (grp, [k, ad, birim]) => {
    const v = g.veri[k], e = al.veri[k], degisti = v !== e;
    return `<li><button class="fiyat-satir" data-fiyat="${k}"><span class="fs-ad"><b>${kacir(ad)}</b><small>${kacir(birim)}${fiyatKullanim(k).n ? ' · sitede ' + fiyatKullanim(k).n + ' yerde' : ''}</small></span>
      <span class="fs-tutar"><b>${tl(v)}</b><small>${degisti ? `yayın bekliyor · sitede ${tl(e)} (${yuzdeYaz(yuzde(e, v))})` : kacir(karsilik(grp, v))}</small></span></button></li>`;
  };
  kok.innerHTML = `<div class="ust"><button class="geri" id="geri" aria-label="Geri">‹</button><h1>Diğer fiyatlar</h1></div>
    <div class="aciklama-not">Folyo, branda, sticker, foreks ve diğer 15 sipariş ürününün fiyatları ile asgari tutar ve ücretsiz kargo sınırı “Sipariş fiyatları” ekranındadır. Değişiklik "Yayınla"ya basana kadar sitede görünmez.</div>
    <button class="dugme tam" id="sfGit">Sipariş fiyatlarına git</button>
    <button class="buyuk-ekle ikincil" id="toplu">Toplu zam / indirim</button>
    ${FIYAT_GRUPLARI.map((grp) => `<div class="bolum">${kacir(grp.ad)} <span class="kdv-rozet ${grp.kdv}">${kacir(grp.not)}</span></div><ul class="liste">${grp.kalemler.map((x) => satir(grp, x)).join('')}</ul>`).join('')}
    <div class="aciklama-not">Kampanya (üstü çizili eski fiyat, bitiş tarihi) yasal kurallar gereği ayrı bir adımda eklenecek. Şimdilik indirimi fiyatı düşürerek yapabilirsiniz.</div>`;
  $('#geri').onclick = () => history.back();
  $('#toplu').onclick = topluFiyat;
  $('#sfGit').onclick = () => git({ ad: 'album', id: 'siparisFiyat' });
  kok.querySelectorAll('[data-fiyat]').forEach((b) => b.onclick = () => fiyatDuzenle(b.dataset.fiyat));
  yayinCubugu();
}

// Büyük değişiklikte (artış/azalış %50 üstü ya da %25 üstü indirim) ayrı onay. %50 üstü onay, değişikliğin kendisine bağlanır (eski → yeni).
const buyukMu = (e, y) => Math.abs(yuzde(e, y)) > 50;
const ikinciOnayGerekir = (e, y) => buyukMu(e, y) || yuzde(e, y) < -25;
function fiyatOnayEkrani(degisimler, baslik = 'Bu fiyat değişikliği büyük') {
  return new Promise((coz) => {
    const p = perde(`<h2>${kacir(baslik)}</h2>
      <div class="uyari">Lütfen tek tek kontrol edin. Uygulama kâr/maliyet kontrolü yapmaz.</div>
      <ul class="ozet">${degisimler.map(({ k, e, y }) => { const f = fiyatKalemi(k); return `<li><b>${kacir(f.ad)}</b> (${kacir(f.birim)}, ${f.grup.kdv === 'dahil' ? 'KDV dahil' : f.grup.kdv === 'haric' ? 'KDV hariç' : 'tutar'}): ${tl(e)} → <b>${tl(y)}</b> <span class="${y < e ? 'eksi' : 'arti'}">${yuzdeYaz(yuzde(e, y))}</span></li>`; }).join('')}</ul>
      <button class="dugme ana tam ara-bosluk" id="evet">Evet, bu fiyatlar doğru</button><button class="dugme tam ara-bosluk" id="hayir">Vazgeç</button>`, { kilitli: true });
    $('#evet', p).onclick = () => { p.remove(); coz(true); };
    $('#hayir', p).onclick = () => { p.remove(); coz(false); };
  });
}
async function fiyatlariKaydet(degisimler) {
  // degisimler: [{k, e (sitedeki), y (yeni)}]. Her fiyat ayrı "alan" işlemi; %50 üstü onaylılar için buyuk_onay kaydı eklenir.
  const al = fiyatAlbum();
  let L = D.islemler.slice();
  for (const { k, y } of degisimler) {
    const yol = [k]; const onceki = L.find((i) => i.album === al.id && i.tur === 'alan' && esit(i.yol, yol));
    const eski = onceki ? onceki.eski : al.veri[k];
    L = L.filter((i) => i !== onceki && !(i.album === al.id && esit(i.yol, ['buyuk_onay', k])));
    if (y !== eski) {
      L.push({ tur: 'alan', album: al.id, yol, eski, yeni: y });
      if (buyukMu(eski, y)) L.push({ tur: 'alan', album: al.id, yol: ['buyuk_onay', k], eski: kopya(yolAl(al.veri, ['buyuk_onay', k])), yeni: [eski, y] });
    }
  }
  await taslakYaz(L);
}

function fiyatDuzenle(k) {
  const al = fiyatAlbum(); const f = fiyatKalemi(k); const g = gorunenAlbum(al);
  const e = al.veri[k], simdi = g.veri[k]; const [lo, hi] = fiyatAralik(k); const kul = fiyatKullanim(k);
  const p = perde(`<h2>${kacir(f.ad)}</h2>
    <div class="kdv-rozet buyuk ${f.grup.kdv}">${kacir(f.birim)} · ${kacir(f.grup.not)}</div>
    <label class="alan"><span>Yeni fiyat (₺)</span><input class="duz fiyat-girdi" id="fg" inputmode="numeric" pattern="[0-9]*" value="${simdi}"></label>
    <div id="fo" class="fiyat-ozet"></div>
    <div class="aciklama-not perde-not">${kul.n ? `Sitede ${kul.n} yerde geçiyor: ${kacir(kul.yerler.slice(0, 6).join(', '))}${kul.yerler.length > 6 ? '…' : ''}.` : 'Fiyat hesaplayıcılarında kullanılıyor.'} Hepsi birlikte güncellenir.</div>
    <div id="uy"></div>
    <button class="dugme ana tam" id="kaydet">Kaydet</button>
    ${simdi !== e ? '<button class="dugme tam ara-bosluk" id="geri">Sitedeki fiyata dön</button>' : ''}
    <button class="dugme tam ara-bosluk" id="vazgec">Vazgeç</button>`, { tam: true });
  const k1 = $('#fg', p);
  const oku = () => (/^\d+$/.test(k1.value.trim()) ? parseInt(k1.value.trim(), 10) : NaN);
  const goster = () => {
    const y = oku();
    $('#fo', p).innerHTML = isNaN(y) ? '<div class="hata-kutu bosluksuz">Yalnızca rakam girin (kuruş ve nokta olmadan).</div>'
      : `<div class="fo-satir"><span>Sitedeki fiyat</span><b>${tl(e)}</b></div><div class="fo-satir"><span>Yeni fiyat</span><b>${tl(y)}</b></div>
         <div class="fo-satir"><span>Değişim</span><b class="${y < e ? 'eksi' : y > e ? 'arti' : ''}">${yuzdeYaz(yuzde(e, y))}</b></div>
         ${f.grup.kdv ? `<div class="fo-satir"><span>${f.grup.kdv === 'haric' ? 'Sitede KDV (%20) dahil görünen' : 'KDV (%20) hariç karşılığı'}</span><b>${tl(f.grup.kdv === 'haric' ? y * (1 + KDV) : y / (1 + KDV))}</b></div>` : ''}`;
  };
  k1.oninput = goster; goster();
  $('#vazgec', p).onclick = () => p.remove();
  if ($('#geri', p)) $('#geri', p).onclick = async () => { try { await fiyatlariKaydet([{ k, e, y: e }]); } catch (x) { return hataPenceresi('Kaydedilemedi', x.message); } p.remove(); ciz(); };
  $('#kaydet', p).onclick = async () => {
    const y = oku();
    if (isNaN(y)) return;
    if (y < lo || y > hi) { $('#uy', p).innerHTML = `<div class="hata-kutu bosluksuz">Bu fiyat ${tl(lo)} ile ${tl(hi)} arasında olmalı.</div>`; return; }
    if (ikinciOnayGerekir(e, y) && !(await fiyatOnayEkrani([{ k, e, y }]))) return;
    try { await fiyatlariKaydet([{ k, e, y }]); } catch (x) { return hataPenceresi('Kaydedilemedi', x.message); }
    p.remove(); bildir('Telefona kaydedildi — henüz sitede değil. Hazır olunca “Yayınla”ya basın.', 3500); ciz();
  };
}

function topluFiyat() {
  const al = fiyatAlbum(); const g = gorunenAlbum(al);
  const gruplar = FIYAT_GRUPLARI.filter((x) => x.toplu);
  const secili = new Set(gruplar.filter((x) => x.varsayilan).flatMap((x) => x.kalemler.map((k) => k[0])));
  let oran = 10, yuvar = 0, gecersiz = false;
  const p = perde('', { tam: true });
  const hesap = () => gruplar.flatMap((grp) => grp.kalemler.map(([k, ad]) => {
    const once = g.veri[k]; const ham = once * (1 + oran / 100);
    const y = yuvar ? Math.round(ham / yuvar) * yuvar : Math.round(ham);
    return { k, ad, grp, once, ham, y, e: al.veri[k] };
  }));
  const ciz2 = () => {
    const H = hesap();
    p.querySelector('.sayfa').innerHTML = `<div class="tutamak"></div><h2>Toplu zam / indirim</h2>
      <label class="alan"><span>Yüzde (indirim için eksi yazın, örn. -10)</span><input class="duz fiyat-girdi" id="or" inputmode="text" value="${oran}"></label>
      <div class="secenekler" id="yv">${[[0, 'Yuvarlama yok'], [10, '10 ₺'], [50, '50 ₺']].map(([v, ad]) => `<button data-yv="${v}" class="${v === yuvar ? 'secili' : ''}">${ad}</button>`).join('')}</div>
      <div class="aciklama-not perde-not">Uygulama kâr/maliyet kontrolü yapmaz.</div>
      ${gruplar.map((grp) => `<div class="bolum perde-bolum">${kacir(grp.ad)} <span class="kdv-rozet ${grp.kdv}">${kacir(grp.not)}</span></div>
        <ul class="liste">${H.filter((x) => x.grp === grp).map((x) => `<li><label class="toplu-satir"><input type="checkbox" data-k="${x.k}" ${secili.has(x.k) ? 'checked' : ''}>
          <span class="fs-ad"><b>${kacir(x.ad)}</b></span><span class="fs-tutar">${secili.has(x.k) ? `${tl(x.once)} → <b>${tl(x.y)}</b>${yuvar && Math.round(x.ham) !== x.y ? `<small>hesaplanan ${tl(x.ham)}</small>` : ''}` : `<small>${tl(x.once)} · değişmez</small>`}</span></label></li>`).join('')}</ul>`).join('')}
      <div id="uy"></div>
      <button class="dugme ana tam ara-bosluk" id="uygula">${secili.size} fiyata uygula</button>
      <button class="dugme tam ara-bosluk" id="vazgec">Vazgeç</button>`;
    const or = $('#or', p);
    or.onchange = () => { const t = or.value.trim().replace(',', '.').replace('%', ''); const v = /^[+-]?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN; if (!isNaN(v) && v > -90 && v < 300 && v !== 0) { gecersiz = false; if (v !== oran) { oran = v; ciz2(); } } else { gecersiz = true; $('#uy', p).innerHTML = '<div class="hata-kutu bosluksuz">Geçerli bir yüzde girin (örn. 10 ya da -15). İşlem yapılmadı.</div>'; } };
    p.querySelectorAll('[data-yv]').forEach((b) => b.onclick = () => { yuvar = +b.dataset.yv; ciz2(); });
    p.querySelectorAll('[data-k]').forEach((c) => c.onchange = () => { c.checked ? secili.add(c.dataset.k) : secili.delete(c.dataset.k); ciz2(); });
    $('#vazgec', p).onclick = () => p.remove();
    $('#uygula', p).onclick = async () => {
      or.onchange();
      if (gecersiz) return;
      const S = hesap().filter((x) => secili.has(x.k) && x.y !== x.once);
      if (!S.length) { $('#uy', p).innerHTML = '<div class="hata-kutu bosluksuz">Değişecek fiyat yok.</div>'; return; }
      const disari = S.filter((x) => { const [lo, hi] = fiyatAralik(x.k); return x.y < lo || x.y > hi; });
      if (disari.length) { $('#uy', p).innerHTML = `<div class="hata-kutu bosluksuz">İzin verilen aralığın dışına çıkıyor: ${kacir(disari.map((x) => x.ad).join(', '))}.</div>`; return; }
      // Her zaman tam liste onayı (toplu işlem); büyük olanlar ayrıca işaretli.
      if (!(await fiyatOnayEkrani(S.map((x) => ({ k: x.k, e: x.e, y: x.y })), S.length + ' fiyat değişecek'))) return;
      try { await fiyatlariKaydet(S.map((x) => ({ k: x.k, e: x.e, y: x.y }))); } catch (x) { return hataPenceresi('Kaydedilemedi', x.message); }
      p.remove(); bildir(S.length + ' fiyat telefona kaydedildi — henüz sitede değil.', 3500); ciz();
    };
  };
  ciz2();
}

// ---------- sipariş fiyatları (siparis/src/fiyatlar.json) ----------
// Hesaplayıcıların kullandığı bütün fiyatlar. Yapı değiştirilemez; yalnızca fiyat sayıları değişir.
const URUN_ADI = { 'foreks-baski': 'Foreks Baskı', 'fotoblok-baski': 'Fotoblok Baskı' };
function siparisKalemleri(V) {
  const K = [];
  const ekle = (yol, urun, ad, birim, tip = 'tl') => K.push({ yol, urun, ad, birim, tip });
  ekle(['genel', 'asgari_baski'], 'Genel', 'Asgari baskı tutarı', 'sipariş başı');
  ekle(['genel', 'kargo_ucretsiz_esik'], 'Genel', 'Ücretsiz kargo sınırı', 'sipariş tutarı');
  for (const [kod, u] of Object.entries(V.urunler || {})) {
    const ad = u.ad || URUN_ADI[kod] || kod; const y = (...p) => ['urunler', kod, ...p];
    (u.malzemeler || []).forEach((m, i) => { if (typeof m.m2 === 'number' && m.m2 > 0) ekle(y('malzemeler', i, 'm2'), ad, (u.malzeme_baslik ? u.malzeme_baslik + ' ' : '') + m.ad, 'm²'); });
    (u.kademeler || []).forEach((m, i) => ekle(y('kademeler', i, 'm2'), ad, m.ad, 'm²'));
    (u.paketler || []).forEach((m, i) => { ekle(y('paketler', i, 'tek'), ad, m.adet + ' adet, tek yüz', 'paket'); if (typeof m.cift === 'number') ekle(y('paketler', i, 'cift'), ad, m.adet + ' adet, çift yüz', 'paket'); });
    if (typeof u.metre_fiyat === 'number') ekle(y('metre_fiyat'), ad, (u.rulo_en || 40) + ' cm rulo', 'metre');
    if (u.tabaka && typeof u.tabaka.fiyat === 'number') ekle(y('tabaka', 'fiyat'), ad, u.tabaka.en + ' × ' + u.tabaka.boy + ' cm tabaka', 'tabaka');
    if (u.kusgozu && typeof u.kusgozu.fiyat === 'number') ekle(y('kusgozu', 'fiyat'), ad, 'Kuşgözü', 'adet');
    if (u.cerceve) (u.cerceve.olculer || []).forEach((o, i) => Object.keys(o.fiyat || {}).forEach((r) => ekle(y('cerceve', 'olculer', i, 'fiyat', r), ad, 'Çerçeve ' + o.ad + ', ' + (r === 'mese' ? 'meşe' : r), 'adet')));
    if (u.laminasyon && typeof u.laminasyon.carpan === 'number') ekle(y('laminasyon', 'carpan'), ad, 'Laminasyon çarpanı (baskı fiyatı ×)', 'çarpan', 'carpan');
  }
  return K;
}
const sfAlbum = () => D.albumler.find((a) => a.id === 'siparisFiyat');
const sfYaz = (k, v) => k.tip === 'carpan' ? '× ' + String(v).replace('.', ',') : tl(v);
const sfAralik = (k) => k.tip === 'carpan' ? [1, 4] : k.yol[1] === 'kargo_ucretsiz_esik' ? [0, 200000] : k.yol[1] === 'asgari_baski' ? [0, 20000] : k.birim === 'adet' && k.ad === 'Kuşgözü' ? [1, 1000] : [50, 60000];
function siparisFiyatEkrani() {
  const al = sfAlbum(); if (!al) return git({ ad: 'ana' }, true);
  const g = gorunenAlbum(al); const K = siparisKalemleri(al.veri);
  const gruplar = [...new Set(K.map((k) => k.urun))];
  kok.innerHTML = `<div class="ust"><button class="geri" id="geri" aria-label="Geri">‹</button><h1>Sipariş fiyatları</h1></div>
    <div class="aciklama-not">Bütün fiyatlar KDV hariç girilir. Bir fiyat değişince o ürünün fiyat hesaplayıcısı, anasayfadaki düğmede yazan başlangıç fiyatı ve sayfa metinlerindeki fiyat birlikte değişir. "Yayınla"ya basana kadar sitede görünmez.</div>
    ${gruplar.map((u) => `<div class="bolum">${kacir(u)}</div><ul class="liste">${K.filter((k) => k.urun === u).map((k) => {
      const v = yolAl(g.veri, k.yol), e = yolAl(al.veri, k.yol), degisti = v !== e;
      return `<li><button class="fiyat-satir" data-sf="${kacir(JSON.stringify(k.yol))}"><span class="fs-ad"><b>${kacir(k.ad)}</b><small>${kacir(k.birim)}</small></span>
        <span class="fs-tutar"><b>${sfYaz(k, v)}</b><small>${degisti ? `yayın bekliyor · sitede ${sfYaz(k, e)}` : k.tip === 'tl' && k.urun !== 'Genel' ? 'KDV dahil ' + tl(v * (1 + KDV)) : ''}</small></span></button></li>`; }).join('')}</ul>`).join('')}`;
  $('#geri').onclick = () => history.back();
  kok.querySelectorAll('[data-sf]').forEach((b) => b.onclick = () => siparisFiyatDuzenle(JSON.parse(b.dataset.sf)));
  yayinCubugu();
}
async function siparisFiyatKaydet(yol, y) {
  const al = sfAlbum();
  const onceki = D.islemler.find((i) => i.album === al.id && i.tur === 'alan' && esit(i.yol, yol));
  const eski = onceki ? onceki.eski : yolAl(al.veri, yol);
  const L = D.islemler.filter((i) => i !== onceki);
  await taslakYaz(y === eski ? L : [...L, { tur: 'alan', album: al.id, yol, eski, yeni: y }]);
}
function siparisFiyatDuzenle(yol) {
  const al = sfAlbum(); const k = siparisKalemleri(al.veri).find((x) => esit(x.yol, yol)); if (!k) return;
  const e = yolAl(al.veri, yol), simdi = yolAl(gorunenAlbum(al).veri, yol); const [lo, hi] = sfAralik(k);
  const p = perde(`<h2>${kacir(k.urun)}</h2><div class="kdv-rozet buyuk haric">${kacir(k.ad)} · ${kacir(k.birim)}${k.tip === 'tl' ? ' · KDV hariç girilir' : ''}</div>
    <label class="alan"><span>${k.tip === 'carpan' ? 'Yeni çarpan (örn. 1,75)' : 'Yeni fiyat (₺)'}</span><input class="duz fiyat-girdi" id="fg" inputmode="${k.tip === 'carpan' ? 'decimal' : 'numeric'}" value="${String(simdi).replace('.', ',')}"></label>
    <div id="fo" class="fiyat-ozet"></div><div id="uy"></div>
    <button class="dugme ana tam" id="kaydet">Kaydet</button>
    ${simdi !== e ? '<button class="dugme tam ara-bosluk" id="geri">Sitedeki fiyata dön</button>' : ''}
    <button class="dugme tam ara-bosluk" id="vazgec">Vazgeç</button>`, { tam: true });
  const g1 = $('#fg', p);
  const oku = () => { const t = g1.value.trim().replace(',', '.'); return k.tip === 'carpan' ? (/^\d+(\.\d{1,2})?$/.test(t) ? parseFloat(t) : NaN) : (/^\d+$/.test(t) ? parseInt(t, 10) : NaN); };
  const goster = () => { const y = oku(); $('#fo', p).innerHTML = isNaN(y) ? `<div class="hata-kutu bosluksuz">${k.tip === 'carpan' ? 'Örn. 1,75 gibi bir sayı girin.' : 'Yalnızca rakam girin (kuruş ve nokta olmadan).'}</div>`
    : `<div class="fo-satir"><span>Sitedeki</span><b>${sfYaz(k, e)}</b></div><div class="fo-satir"><span>Yeni</span><b>${sfYaz(k, y)}</b></div><div class="fo-satir"><span>Değişim</span><b class="${y < e ? 'eksi' : y > e ? 'arti' : ''}">${yuzdeYaz(yuzde(e, y))}</b></div>${k.tip === 'tl' && k.urun !== 'Genel' ? `<div class="fo-satir"><span>Müşterinin gördüğü KDV dahil</span><b>${tl(y * (1 + KDV))}</b></div>` : ''}`; };
  g1.oninput = goster; goster();
  $('#vazgec', p).onclick = () => p.remove();
  if ($('#geri', p)) $('#geri', p).onclick = async () => { try { await siparisFiyatKaydet(yol, e); } catch (x) { return hataPenceresi('Kaydedilemedi', x.message); } p.remove(); ciz(); };
  $('#kaydet', p).onclick = async () => {
    const y = oku(); if (isNaN(y)) return;
    if (y < lo || y > hi) { $('#uy', p).innerHTML = `<div class="hata-kutu bosluksuz">Bu değer ${sfYaz(k, lo)} ile ${sfYaz(k, hi)} arasında olmalı.</div>`; return; }
    if (ikinciOnayGerekir(e, y) && !(await new Promise((coz) => { const q = perde(`<h2>Bu fiyat değişikliği büyük</h2><div class="uyari">Lütfen kontrol edin. Uygulama kâr/maliyet kontrolü yapmaz.</div><ul class="ozet"><li><b>${kacir(k.urun + ' — ' + k.ad)}</b>: ${sfYaz(k, e)} → <b>${sfYaz(k, y)}</b> <span class="${y < e ? 'eksi' : 'arti'}">${yuzdeYaz(yuzde(e, y))}</span></li></ul><button class="dugme ana tam ara-bosluk" id="evet">Evet, doğru</button><button class="dugme tam ara-bosluk" id="hayir">Vazgeç</button>`, { kilitli: true }); $('#evet', q).onclick = () => { q.remove(); coz(true); }; $('#hayir', q).onclick = () => { q.remove(); coz(false); }; }))) return;
    try { await siparisFiyatKaydet(yol, y); } catch (x) { return hataPenceresi('Kaydedilemedi', x.message); }
    p.remove(); bildir('Telefona kaydedildi — henüz sitede değil. Hazır olunca “Yayınla”ya basın.', 3500); ciz();
  };
}

// ---------- yeni vaka çalışması ----------
function yeniVakaEkrani() {
  let kapak = null;
  const p = perde(`<h2>Yeni vaka çalışması</h2>
    <div class="aciklama-not perde-not2">Mevcut vaka sayfasıyla aynı tasarımda yeni bir sayfa oluşur. Şimdi temel bilgileri girin; diğer yazıları ve kareleri sonra ekleyebilirsiniz. Yayınlayana kadar sitede bir şey değişmez.</div>
    <label class="alan"><span>Firma adı</span><input class="duz" id="v1" maxlength="80"></label>
    <label class="alan"><span>Sayfa başlığı (örn. “Firma: cephe tabela uygulaması”)</span><input class="duz" id="v2" maxlength="120"></label>
    <label class="alan"><span>Sayfa adresi</span><input class="duz" id="v3" maxlength="60" inputmode="url" autocapitalize="off"></label>
    <div class="aciklama-not" id="v3g"></div>
    <img class="onizleme yok" id="voz" alt="">
    <button class="dugme tam" id="vfoto">Kapak fotoğrafı seç</button>
    <label class="alan"><span>Kapak fotoğrafında ne var?</span><input class="duz" id="v4" maxlength="160"></label>
    <div id="vuy"></div>
    <button class="dugme ana tam" id="volustur">Oluştur</button><button class="dugme tam ara-bosluk" id="vvz">Vazgeç</button>`, { tam: true });
  const adres = () => { const v = $('#v3', p).value; $('#v3g', p).textContent = 'istanbulprintlab.com/projeler/' + (v || '…') + '/'; };
  let elle = false;
  $('#v1', p).oninput = () => { if (!elle) { $('#v3', p).value = slug($('#v1', p).value).replace(/^foto$/, ''); adres(); } };
  $('#v3', p).oninput = () => { elle = true; $('#v3', p).value = $('#v3', p).value.toLocaleLowerCase('tr').replace(/[^a-z0-9-]/g, ''); adres(); };
  adres();
  $('#vvz', p).onclick = () => p.remove();
  $('#vfoto', p).onclick = () => {
    const inp = $('#dosya'); inp.value = ''; inp.multiple = false;
    inp.onchange = async () => {
      inp.multiple = true; const F = inp.files[0]; if (!F) return;
      try { const h = await kucult(F); kapak = h; const im = $('#voz', p); im.src = URL.createObjectURL(h.blob); im.classList.remove('yok'); $('#vfoto', p).textContent = 'Kapak fotoğrafını değiştir'; }
      catch (e) { hataPenceresi('Fotoğraf eklenemedi', e.message); }
    };
    inp.click();
  };
  $('#volustur', p).onclick = async () => {
    const firma = $('#v1', p).value.trim().replace(/[<>]/g, ''), baslik = $('#v2', p).value.trim().replace(/[<>]/g, ''), sl = $('#v3', p).value.trim(), alt = $('#v4', p).value.trim().replace(/[<>]/g, '');
    const hata = !firma ? 'Firma adını yazın.' : !baslik ? 'Sayfa başlığını yazın.' : !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sl) ? 'Sayfa adresi yalnızca küçük harf, rakam ve tire içerebilir.'
      : D.albumler.some((a) => a.tur === 'vaka' && a.sayfa === '/projeler/' + sl + '/') ? 'Bu adreste zaten bir vaka çalışması var.' : !kapak ? 'Kapak fotoğrafı seçin.' : !alt ? 'Kapak fotoğrafında ne olduğunu kısaca yazın.' : '';
    if (hata) { $('#vuy', p).innerHTML = `<div class="hata-kutu bosluksuz">${kacir(hata)}</div>`; return; }
    const yol = `/img/yuklenen/vakalar/${sl}-kapak-${Date.now().toString(36)}.jpg`;
    const veri = { slug: sl, seo_baslik: '', seo_aciklama: '', firma, etiket: '', baslik, kapak: yol, kapak_aciklama: alt, ihtiyac: '', zorluk: '', cozum: [], bilgiler: [{ ad: 'Müşteri', deger: firma }], kareler: [] };
    const id = 'content/vakalar/' + sl + '.json';
    try { await taslakYaz([...D.islemler, { tur: 'yeniVaka', album: id, veri, dosya: yol }], { dosyaEkle: [[yol, kapak.blob]] }); }
    catch (e) { return hataPenceresi('Kaydedilemedi', e.message); }
    D.onizleme[yol] = URL.createObjectURL(kapak.blob);
    if (!D.albumler.some((a) => a.id === id)) D.albumler.push({ id, tur: 'vaka', yeni: true, ad: firma, aciklama: 'Yeni vaka çalışması — henüz sitede değil', yol: id, alan: 'kareler', klasor: 'vakalar', sayfa: '/projeler/' + sl + '/', oid: null, veri: kopya(veri) });
    p.remove(); bildir('Vaka oluşturuldu — şimdi yazılarını ve karelerini ekleyin.', 3500); git({ ad: 'album', id, sekme: 'metin' });
  };
}

// ---------- satış bağlantıları kontrolü (yalnızca okur, hiçbir şeyi değiştirmez) ----------
async function baglantiKontrolu() {
  const p = perde(`<h2>Satış bağlantıları</h2><div class="ilerleme"><i id="bi"></i></div><div class="aciklama-not perde-not" id="bm">Site haritası okunuyor…</div><div id="bs"></div>
    <button class="dugme tam ara-bosluk" id="bk">Kapat</button>`, { tam: true });
  let dur = false; $('#bk', p).onclick = () => { dur = true; p.remove(); };
  const il = D.albumler.find((a) => a.tur === 'iletisim')?.veri || {};
  const tel = String(il.telefon || '').replace(/\D/g, ''), ep = String(il.eposta || '').toLowerCase();
  try {
    const sm = await fetch('/sitemap.xml', { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('Site haritası okunamadı.'); return r.text(); });
    const yollar = [...new Set([...sm.matchAll(/<loc>https:\/\/www\.istanbulprintlab\.com(\/[^<]*)<\/loc>/g)].map((m) => m[1]))];
    const S = []; let n = 0;
    const tek = async (y) => {
      let h = null; try { const r = await fetch(y, { cache: 'no-store' }); if (r.ok) h = await r.text(); else S.push({ y, s: `Sayfa açılmıyor (${r.status})` }); } catch (_) { S.push({ y, s: 'Sayfa açılamadı' }); }
      if (h) {
        const wa = [...h.matchAll(/href="https:\/\/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\d+)/g)].map((m) => m[1]);
        const tl2 = [...h.matchAll(/href="tel:([^"]*)"/g)].map((m) => m[1].replace(/\D/g, ''));
        const ml = [...h.matchAll(/href="mailto:([^"?]*)/g)].map((m) => m[1].toLowerCase());
        const yanlis = [...wa.filter((x) => x !== tel).map((x) => 'WhatsApp numarası farklı: ' + x), ...tl2.filter((x) => x !== tel).map((x) => 'Telefon numarası farklı: ' + x), ...ml.filter((x) => x !== ep).map((x) => 'E-posta farklı: ' + x)];
        if (!wa.length && !tl2.length) yanlis.push('Sayfada WhatsApp ya da telefon bağlantısı yok');
        for (const m of h.matchAll(/<form\b[^>]*>/g)) if (/method="post"/i.test(m[0]) && !/data-netlify="true"/.test(m[0])) yanlis.push('Teklif formu gelen kutusuna bağlı görünmüyor');
        for (const x of [...new Set(yanlis)]) S.push({ y, s: x });
      }
      n++; if (!dur) { $('#bi', p).style.width = Math.round((n / yollar.length) * 100) + '%'; $('#bm', p).textContent = `${n} / ${yollar.length} sayfa kontrol edildi`; }
    };
    for (let k = 0; k < yollar.length && !dur; k += 4) await Promise.all(yollar.slice(k, k + 4).map(tek));
    if (dur) return;
    $('#bm', p).textContent = `${yollar.length} sayfa kontrol edildi. Doğru numara: ${il.telefon || '?'}, e-posta: ${il.eposta || '?'}.`;
    $('#bs', p).innerHTML = S.length ? `<div class="hata-kutu bosluksuz">${S.length} sorun bulundu</div><ul class="ozet">${S.map((x) => `<li><a href="${kacir(siteYolu(x.y))}" target="_blank" rel="noopener">${kacir(x.y)}</a>: ${kacir(x.s)}</li>`).join('')}</ul>`
      : '<div class="durum iyi">✓ Bütün sayfalarda WhatsApp, telefon ve e-posta bağlantıları doğru numara/adrese gidiyor; teklif formları gelen kutusuna bağlı. (Bağlantıların biçimi kontrol edildi; deneme mesajı gönderilmedi.)</div>';
  } catch (e) { if (!dur) $('#bs', p).innerHTML = `<div class="hata-kutu bosluksuz">${kacir(e.message)}</div>`; }
}

// ---------- yayın öncesi bütünlük kontrolü (siteyi değiştirmez) ----------
async function butunlukKontrolu() {
  const U = []; const adres = new Set();
  const varMi = async (y) => { if (D.onizleme[y]) return true; try { const r = await fetch(y, { method: 'HEAD', cache: 'no-store' }); return r.ok; } catch (_) { return null; } };
  for (const id of new Set(D.islemler.map((i) => i.album))) {
    const al = D.albumler.find((a) => a.id === id); if (!al) { U.push({ ad: id, s: 'Sayfa bulunamadı', agir: true }); continue; }
    if (al.tur === 'html') {
      for (const i of D.islemler.filter((x) => x.album === id && x.tur === 'html')) {
        if (/^g\d+$/.test(i.anahtar)) { if (!i.yeni.alt) U.push({ id, ad: al.ad, s: 'Fotoğraf açıklaması boş', agir: true }); if (!i.dosya) adres.add(JSON.stringify([id, al.ad, i.yeni.src])); continue; }
        const v = META[i.anahtar] ? i.yeni : htmlDenMetin(i.yeni);
        if (!String(v || '').trim()) U.push({ id, ad: al.ad, s: 'Boş yazı kalıyor', agir: true });
        for (const m of String(i.yeni || '').matchAll(/href="(\/[^"#?]*)/g)) adres.add(JSON.stringify([id, al.ad, m[1]]));
      }
      continue;
    }
    if (al.tur === 'fiyatlar' || al.tur === 'iletisim') continue;
    const g = gorunenAlbum(al);
    const S = SEMA[al.tur];
    for (const d of (S ? S.metin : [])) if (d.zorunlu && !String(yolAl(g.veri, d.yol) ?? '').trim()) U.push({ id, ad: al.ad, s: d.ad + ' boş', agir: true });
    if (al.yeni) { for (const [k, ad] of [['ihtiyac', 'Müşterinin ihtiyacı'], ['zorluk', 'İşin zorluğu']]) if (!String(g.veri[k] || '').trim()) U.push({ id, ad: al.ad, s: ad + ' yazılmamış (sayfada başlığı boş görünür)' }); if (!(g.veri.cozum || []).length) U.push({ id, ad: al.ad, s: 'Çözüm maddeleri yazılmamış (sayfada başlığı boş görünür)' }); if (!(g.veri.kareler || []).length) U.push({ id, ad: al.ad, s: 'Uygulamadan kare eklenmemiş' }); }
    if (al.alan) for (const x of liste(g)) if (x.gorsel) adres.add(JSON.stringify([id, al.ad, x.gorsel]));
    if (al.tur === 'vaka' && g.veri.kapak) adres.add(JSON.stringify([id, al.ad, g.veri.kapak]));
    for (const m of JSON.stringify(g.veri).matchAll(/\]\((\/[^)#?\s]*)/g)) adres.add(JSON.stringify([id, al.ad, m[1]]));
  }
  const yeniSayfalar = new Set(D.albumler.filter((a) => a.yeni).map((a) => a.sayfa));
  const L = [...adres].map((x) => JSON.parse(x)).filter(([, , y]) => !yeniSayfalar.has(y));
  for (let k = 0; k < L.length; k += 6) await Promise.all(L.slice(k, k + 6).map(async ([id, ad, y]) => {
    const v = await varMi(y); const foto = /\.(webp|jpe?g|png)$/i.test(y);
    if (v === false) U.push({ id, ad, s: (foto ? 'Fotoğraf sitede bulunamadı: ' : 'Bağlantı açılmıyor: ') + y, agir: foto });
    if (v === null) U.push({ id, ad, s: 'Kontrol edilemedi (internet): ' + y });
  }));
  return U;
}
function etkilenenSayfalar() {
  const S = new Map();
  for (const i of D.islemler) {
    if (i.album === 'iletisim') { S.set('*', 'Bütün sayfalar (iletişim bilgisi)'); continue; }
    if (i.album === 'fiyatlar' || i.album === 'siparisFiyat') { S.set('*f', 'Fiyat geçen bütün sayfalar'); continue; }
    const al = D.albumler.find((a) => a.id === i.album); if (!al) continue;
    if (al.tur === 'projeler' || al.tur === 'anasayfa') S.set('/', 'Anasayfa'); else S.set(al.sayfa, al.ad);
  }
  return [...S].map(([yol, ad]) => ({ yol: yol.startsWith('*') ? null : yol, ad }));
}

// ---------- yayınlama ----------
function ozet() {
  const say = {};
  for (const i of D.islemler) {
    if (i.album === 'fiyatlar' || i.album === 'siparisFiyat' || i.album === 'iletisim') continue; // ayrı kutuda gösterilir
    const al = D.albumler.find((a) => a.id === i.album); const k = al ? al.ad : i.album;
    say[k] = say[k] || { ekle: [], diger: 0, metin: [] };
    if (i.tur === 'yeniVaka') { say[k].metin.push('Yeni vaka çalışması sayfası oluşturulacak: ' + kacir(SITE.replace('https://', '') + '/projeler/' + i.veri.slug + '/')); continue; }
    if (i.tur === 'ekle' && i.tasindi) { say[k].metin.push('Başka sayfadan taşınan fotoğraf'); continue; }
    if (i.tur === 'kaldir' && i.tasiHedef) { const h = D.albumler.find((a) => a.id === i.tasiHedef); say[k].metin.push('Fotoğraf taşınıyor → ' + kacir(h ? h.ad : 'başka sayfa')); continue; }
    if (i.tur === 'ekle') say[k].ekle.push(i.gorsel); else if (i.tur === 'html') say[k].metin.push(htmlDegisikligiOzeti(i)); else if (i.tur === 'alan' || i.tur === 'liste') say[k].metin.push(metinDegisikligiOzeti(i)); else say[k].diger++;
  }
  return Object.entries(say).map(([k, v]) => `<li><b>${kacir(k)}</b>${v.ekle.length || v.diger ? ': ' + [v.ekle.length ? v.ekle.length + ' yeni fotoğraf' : '', v.diger ? v.diger + ' fotoğraf düzenlemesi' : ''].filter(Boolean).join(', ') : ''}
    ${v.ekle.length ? `<div class="secim-ust">${v.ekle.map((g) => `<img src="${kacir(resimAdresi(g))}" alt="">`).join('')}</div>` : ''}
    ${v.metin.length ? `<ul class="metin-ozet">${v.metin.map((m) => `<li>${m}</li>`).join('')}</ul>` : ''}</li>`).join('');
}

function fiyatOzeti() {
  const I = D.islemler.filter((i) => i.album === 'iletisim');
  const ik = I.length ? `<div class="fiyat-kutu kirmizi"><b>İletişim bilgisi değişiyor — bütün sayfalarda</b><ul>${I.map((i) => `<li>${metinDegisikligiOzeti(i)}</li>`).join('')}</ul></div>` : '';
  const F = D.islemler.filter((i) => (i.album === 'fiyatlar' && i.tur === 'alan' && i.yol.length === 1) || i.album === 'siparisFiyat');
  if (!F.length) return ik ? ik + '<label class="anahtar"><input type="checkbox" id="fkontrol"><span>Yukarıdaki değişiklikleri kontrol ettim</span></label>' : '';
  return ik + fiyatKutusu(F);
}
function fiyatKutusu(F) {
  return `<div class="fiyat-kutu"><b>Fiyat değişiklikleri (${F.length})</b><ul>${F.map((i) => { const sk = i.album === 'siparisFiyat' && sfAlbum() ? siparisKalemleri(sfAlbum().veri).find((x) => esit(x.yol, i.yol)) : null; const f = sk ? { ad: sk.urun + ' — ' + sk.ad } : fiyatKalemi(i.yol[0]); const yz = (v) => sk ? sfYaz(sk, v) : tl(v); return `<li>${kacir(f ? f.ad : i.yol.join(' › '))}: ${yz(i.eski)} → <b>${yz(i.yeni)}</b> <span class="${i.yeni < i.eski ? 'eksi' : 'arti'}">${yuzdeYaz(yuzde(i.eski, i.yeni))}</span></li>`; }).join('')}</ul>
    <label class="anahtar"><input type="checkbox" id="fkontrol"><span>Fiyat değişikliklerini kontrol ettim</span></label></div>`;
}
function yayinOnay() {
  const fo = fiyatOzeti();
  const p = perde(`<h2>Siteye yayınlansın mı?</h2>${fo}<ul class="ozet">${ozet()}</ul>
    <div id="kontrol"><div class="aciklama-not perde-not2">Kontrol ediliyor: boş yazı, eksik fotoğraf, açılmayan bağlantı…</div></div>
    <div class="aciklama-not perde-not2">Hepsi tek seferde gönderilir. Site 1–2 dakika içinde güncellenir.</div>
    <button class="dugme ana tam" id="evet" disabled>Yayınla</button><button class="dugme tam ara-bosluk" id="hayir">Henüz değil</button>`);
  let agir = false, uyari = false;
  $('#hayir', p).onclick = () => p.remove();
  butunlukKontrolu().then((U) => {
    agir = U.some((x) => x.agir); uyari = U.length > 0 && !agir;
    $('#kontrol', p).innerHTML = !U.length ? '<div class="durum iyi">✓ Kontrol tamam: boş zorunlu yazı yok; yeni fotoğraflar telefonda hazır, mevcut fotoğraf ve bağlantılar sitede bulundu.</div>'
      : `<div class="${agir ? 'hata-kutu' : 'uyari'} bosluksuz"><b>${agir ? 'Yayından önce düzeltilmesi gerekenler' : 'Kontrol uyarıları'}</b><ul>${U.map((x) => `<li>${x.id ? `<button class="bag-dugme" data-git="${kacir(x.id)}">${kacir(x.ad)} ›</button>` : kacir(x.ad)}: ${kacir(x.s)}</li>`).join('')}</ul></div>
         ${agir ? '' : '<label class="anahtar"><input type="checkbox" id="ukontrol"><span>Uyarıları gördüm, yine de yayınla</span></label>'}`;
    $('#evet', p).disabled = agir;
    p.querySelectorAll('[data-git]').forEach((b) => b.onclick = () => { p.remove(); git({ ad: 'album', id: b.dataset.git }); });
  }).catch(() => { uyari = true; $('#kontrol', p).innerHTML = '<div class="uyari bosluksuz">Kontrol tamamlanamadı (internet bağlantısı). Fotoğraf ve bağlantılar doğrulanmadı.</div><label class="anahtar"><input type="checkbox" id="ukontrol"><span>Kontrol yapılamadığını biliyorum, yine de yayınla</span></label>'; $('#evet', p).disabled = false; });
  $('#evet', p).onclick = () => {
    if (agir) return;
    if (fo && !$('#fkontrol', p).checked) { bildir('Önce fiyat değişikliklerini kontrol edip kutuyu işaretleyin.'); return; }
    if (uyari && !$('#ukontrol', p).checked) { bildir('Önce uyarıları okuyup kutuyu işaretleyin.'); return; }
    p.remove(); yayinla();
  };
}

const BEKLEYEN = 'ipl_bekleyen_yayin';
// Bir commit'in dalda olup olmadığını sorar: true / false.
async function daldaMi(sha) {
  const c = await gh(`/repos/${REPO}/compare/${sha}...${DAL}`);
  return c.status === 'identical' || c.status === 'ahead';
}

// Commit dalda doğrulandıktan sonra çağrılır. "Bekleyen yayın" kaydı, telefondaki taslak gerçekten temizlenene kadar silinmez;
// temizlik olmazsa uygulama her açılışta yeniden dener ve bu sırada aynı değişiklikler ikinci kez gönderilemez.
async function yayinBasarili(sha, sayfalar) {
  if (!sayfalar) { try { sayfalar = JSON.parse(localStorage.getItem(BEKLEYEN) || 'null')?.sayfalar; } catch (_) {} }
  sayfalar = sayfalar || etkilenenSayfalar();
  localStorage.setItem(BEKLEYEN, JSON.stringify({ sha, zaman: Date.now(), kaydedildi: true, sayfalar }));
  D.sonYayin = { sha, zaman: Date.now(), durum: 'hazirlaniyor', sayfalar };
  localStorage.setItem('ipl_son_yayin', JSON.stringify(D.sonYayin));
  const yerel = { ...D.onizleme };
  try { await taslakYaz([], { dosyaTemizle: true }); localStorage.removeItem(BEKLEYEN); }
  catch (_) { hataPenceresi('Yayın kaydedildi', 'Değişiklikleriniz siteye gönderildi ama telefondaki taslak temizlenemedi. Uygulamayı kapatıp açın; temizlik otomatik tekrar denenecek. Bu sırada aynı değişiklikler tekrar gönderilmez.'); }
  try { D.albumler = albumleriKur((await icerikOku(sha)).dosyalar); D.sha = sha; } catch (_) { /* liste sonra yenilenir */ }
  D.onizleme = yerel; // site yayına girene kadar yeni fotoğraflar telefondan gösterilir
}

let yayinSuruyor = false;
let GECERLI_VAKALAR = null; // yayın sırasında güncel içerikteki vaka sayfaları
const yayinKilitli = () => !!localStorage.getItem(BEKLEYEN) || D.sonYayin?.durum === 'belirsiz';
async function yayinla(onaylananlar = []) {
  if (yayinSuruyor || !D.islemler.length) return;
  if (yayinKilitli()) {
    // Önceki yayının sonucu netleşmeden yeni yayın yapılmaz.
    bildir('Önceki yayın kontrol ediliyor…', 3000);
    await bekleyenYayiniDogrula();
    ciz();
    if (yayinKilitli()) { hataPenceresi('Önceki yayın henüz doğrulanamadı', 'Bir önceki yayının sitede kayda geçip geçmediği anlaşılamadı (internet bağlantısı). Aynı değişiklikler iki kez gönderilmesin diye yeni yayın bekletiliyor. Biraz sonra tekrar deneyin.'); return; }
    if (!D.islemler.length) return;
  }
  yayinSuruyor = true;
  const p = perde(`<h2>Yayınlanıyor…</h2><div class="ilerleme"><i id="yi"></i></div><div class="aciklama-not perde-not" id="ym">Hazırlanıyor</div>`, { kilitli: true });
  const adim = (yuzde, m) => { $('#yi', p).style.width = yuzde + '%'; $('#ym', p).textContent = m; };
  let commitSha = null;
  try {
    for (let deneme = 1; deneme <= 3; deneme++) {
      adim(5, 'Sitenin güncel hali alınıyor');
      const { sha, dosyalar } = await icerikOku();
      const anlik = albumleriKur(dosyalar);
      GECERLI_VAKALAR = new Set(anlik.filter((a) => a.tur === 'vaka').map((a) => a.sayfa));
      const htmlIlk = {};
      for (const id of new Set(D.islemler.filter((i) => i.tur === 'html').map((i) => i.album))) {
        const a = anlik.find((x) => x.id === id); if (!a) continue;
        adim(6, 'Sayfa okunuyor: ' + a.ad);
        const d = await sayfaOku(sha, a.dosya); a.veri = { kaynak: d.text }; htmlIlk[id] = d.text;
      }

      // Siz düzenlerken aynı sayfa başka yerden değiştiyse önce sorulur.
      const degisen = [...new Set(D.islemler.filter((i) => { const al = anlik.find((a) => a.id === i.album); return al && i.taban && i.tur !== 'alan' && i.tur !== 'liste' && i.taban !== al.oid; }).map((i) => i.album))]
        .filter((id) => !onaylananlar.includes(id));
      if (degisen.length) { p.remove(); yayinSuruyor = false; return cakismaSor(degisen, anlik, onaylananlar); }

      // Tüm değişiklikler uygulanabilmeli; biri bile olmazsa hiçbir şey yayınlanmaz.
      const sorunlu = []; const etkilenen = new Set();
      for (const i of D.islemler) {
        const al = anlik.find((a) => a.id === i.album);
        if (!al) { sorunlu.push({ i, neden: 'Sayfa bulunamadı.' }); continue; }
        try { islemUygula(al, i, true); etkilenen.add(al); } catch (e) { sorunlu.push({ i, neden: e.message, cakisma: !!e.cakisma, mevcut: e.mevcut }); }
      }
      const bloblar = [];
      for (const y of D.islemler) for (const yol of [...(y.tur === 'ekle' && !y.tasindi ? [y.gorsel] : []), ...islemDosyalari(y)]) { const b = await DB.al('dosya', yol); if (!b) sorunlu.push({ i: y, neden: 'Fotoğraf dosyası telefonda bulunamadı.' }); else bloblar.push([yol, b]); }
      if (sorunlu.length) { p.remove(); yayinSuruyor = false; D.albumler = albumleriKur(dosyalar); D.sha = sha; return sorunluGoster(sorunlu); }

      const agac = [];
      for (let n = 0; n < bloblar.length; n++) {
        adim(10 + Math.round((n / Math.max(1, bloblar.length)) * 70), `Fotoğraf yükleniyor ${n + 1} / ${bloblar.length}`);
        const b = await gh(`/repos/${REPO}/git/blobs`, 'POST', { content: await blobB64(bloblar[n][1]), encoding: 'base64' });
        agac.push({ path: 'site' + bloblar[n][0], mode: '100644', type: 'blob', sha: b.sha });
      }
      adim(85, 'Sayfalar güncelleniyor');
      for (const al of etkilenen) {
        if (al.tur === 'html') { if (al.veri.kaynak !== htmlIlk[al.id]) agac.push({ path: al.dosya, mode: '100644', type: 'blob', content: al.veri.kaynak }); continue; }
        const yeni = JSON.stringify(al.veri, null, 2) + '\n';
        if (yeni.trim() !== (dosyalar[al.yol]?.text || '').trim()) agac.push({ path: al.yol, mode: '100644', type: 'blob', content: yeni });
      }
      if (!agac.length) { await taslakYaz([], { dosyaTemizle: true }).catch(() => {}); p.remove(); bildir('Yayınlanacak değişiklik kalmadı.'); return ciz(); }
      const temel = await gh(`/repos/${REPO}/git/commits/${sha}`);
      const tree = await gh(`/repos/${REPO}/git/trees`, 'POST', { base_tree: temel.tree.sha, tree: agac });
      const c = await gh(`/repos/${REPO}/git/commits`, 'POST', { message: `Yönetim uygulaması: ${D.islemler.length} değişiklik`, tree: tree.sha, parents: [sha] });
      commitSha = c.sha;
      localStorage.setItem(BEKLEYEN, JSON.stringify({ sha: c.sha, zaman: Date.now(), sayfalar: etkilenenSayfalar() }));
      adim(95, 'Kaydediliyor');
      try {
        await gh(`/repos/${REPO}/git/refs/heads/${DAL}`, 'PATCH', { sha: c.sha, force: false });
      } catch (e) {
        if (e.durum === 422) {
          // Yalnızca dal bu arada ilerlediyse yeniden denenir; başka bir 422 gerçek hatadır.
          const simdi = await dalSha();
          localStorage.removeItem(BEKLEYEN); commitSha = null;
          if (simdi !== sha && deneme < 3) { adim(5, 'Site bu arada güncellenmiş, yeniden deneniyor'); await bekle(1500); continue; }
          throw e;
        }
        // Yanıt kayboldu: kayıt gerçekleşmiş olabilir. Doğrulanmadan tekrar gönderilmez.
        let sonuc = null;
        try { sonuc = await daldaMi(c.sha); } catch (_) { /* belirsiz */ }
        if (sonuc === false) { localStorage.removeItem(BEKLEYEN); throw e; }
        if (sonuc === null) { D.sonYayin = { sha: c.sha, zaman: Date.now(), durum: 'belirsiz' }; p.remove(); hataPenceresi('Sonuç doğrulanamadı', 'Bağlantı koptuğu için yayının gerçekleşip gerçekleşmediği anlaşılamadı. Değişiklikleriniz telefonda duruyor; uygulama internet gelince kendisi kontrol edecek. Lütfen tekrar “Yayınla”ya basmayın.'); return ciz(); }
      }
      await yayinBasarili(c.sha, etkilenenSayfalar());
      p.remove(); ciz(); yayinIzle();
      return;
    }
  } catch (e) {
    p.remove();
    if (e.oturum) { ciz(); bildir(e.message, 6000); }
    else hataPenceresi('Yayınlanamadı', e.message, '<div class="aciklama-not perde-not2">Sitede hiçbir şey değişmedi. Değişiklikleriniz telefonda duruyor; biraz sonra tekrar deneyin.</div>');
  } finally { yayinSuruyor = false; if (!commitSha) localStorage.removeItem(BEKLEYEN); }
}

function cakismaSor(idler, anlik, onaylananlar) {
  const adlar = idler.map((id) => anlik.find((a) => a.id === id)?.ad || id);
  const p = perde(`<h2>Bu sayfa siz düzenlerken değişti</h2>
    <div class="uyari">${adlar.map(kacir).join(', ')}: başka bir yerden (ör. bilgisayardan) güncellendi.</div>
    <div class="aciklama-not perde-not2">Sizin değişiklikleriniz güncel halin üzerine eklenecek; diğer değişiklikler silinmez. Sıralama beklediğinizden farklı olabilir; yayından sonra kontrol edin.</div>
    <button class="dugme ana tam" id="devam">Yine de yayınla</button><button class="dugme tam ara-bosluk" id="dur">Vazgeç</button>`);
  $('#dur', p).onclick = () => p.remove();
  $('#devam', p).onclick = () => { p.remove(); yayinla([...onaylananlar, ...idler]); };
}

function sorunluGoster(sorunlu) {
  const al = (i) => D.albumler.find((a) => a.id === i.album);
  const ad = (i) => al(i)?.ad || i.album;
  const bolum = (i) => { if (i.tur === 'html') return ' › ' + (META[i.anahtar] ? META[i.anahtar].ad : 'Yazı'); if (al(i)?.tur === 'fiyatlar' && i.yol) { const f = fiyatKalemi(i.yol[0]); return f ? ' › ' + f.ad : ''; } const d = al(i) && i.yol ? alanBul(al(i).tur, i.yol) : null; return d ? ' › ' + d.ad : ''; };
  const goster = (v, i) => { if (i && i.tur === 'html' && /^g\d+$/.test(i.anahtar)) v = (v && v.alt) || v; else if (i && i.tur === 'html' && !META[i.anahtar]) v = htmlDenMetin(v); if (typeof v === 'number') return kacir(tl(v)); const t = sade(metinleri(v).join(' · ')); return kacir(t.length > 140 ? t.slice(0, 140) + '…' : (t || 'boş')); };
  const cakisan = sorunlu.filter((x) => x.cakisma), diger = sorunlu.filter((x) => !x.cakisma);
  const p = perde(`<h2>Yayın durduruldu</h2>
    <div class="aciklama-not perde-not2">Sitede hiçbir şey değiştirilmedi. Aşağıdakileri gözden geçirin.</div>
    ${cakisan.map((x, n) => `<div class="cakisma"><b>${kacir(ad(x.i))}${kacir(bolum(x.i))}</b>
      <div class="aciklama-not perde-not">Siz düzenlerken bu bölüm başka yerden (ör. bilgisayardan) değiştirilmiş.</div>
      <div class="ck-satir"><span>Sitedeki güncel hali</span>${goster(x.mevcut)}</div>
      <div class="ck-satir"><span>Sizin haliniz</span>${goster(x.i.yeni, x.i)}</div>
      <div class="dugmeler"><button class="dugme" data-guncel="${n}">Güncel hali kalsın</button><button class="dugme" data-yeniden="${n}">Benimkini yeniden düzenle</button></div></div>`).join('')}
    ${diger.length ? `<ul class="ozet">${diger.map((x) => `<li><b>${kacir(ad(x.i))}</b>: ${kacir(x.neden)}</li>`).join('')}</ul>
      <button class="dugme ana tam ara-bosluk" id="cikar">Uygulanamayanları çıkar</button>` : ''}
    <button class="dugme tam ara-bosluk" id="kapat">Kapat</button>`);
  $('#kapat', p).onclick = () => p.remove();
  const at = async (L, dosyaSil = []) => { try { await taslakYaz(D.islemler.filter((i) => !L.includes(i)), { dosyaSil }); return true; } catch (e) { hataPenceresi('Kaydedilemedi', e.message); return false; } };
  p.querySelectorAll('[data-guncel]').forEach((b) => b.onclick = async () => { const x = cakisan[+b.dataset.guncel]; if (await at([x.i])) { p.remove(); bildir('Sitedeki güncel hal korundu; sizin değişikliğiniz bırakıldı.', 4000); ciz(); } });
  p.querySelectorAll('[data-yeniden]').forEach((b) => b.onclick = async () => {
    const x = cakisan[+b.dataset.yeniden]; const a2 = al(x.i);
    if (a2 && a2.tur === 'html') { if (!(await at([x.i]))) return; p.remove(); git({ ad: 'album', id: a2.id }); if (await htmlYukle(a2)) { ciz(); htmlDuzenle(a2, x.i.anahtar, META[x.i.anahtar] ? x.i.yeni : htmlDenMetin(x.i.yeni)); } return; }
    if (a2 && a2.id === 'siparisFiyat') { if (!(await at(D.islemler.filter((i) => i.album === 'siparisFiyat' && esit(i.yol, x.i.yol))))) return; p.remove(); git({ ad: 'album', id: 'siparisFiyat' }); return siparisFiyatDuzenle(x.i.yol); }
    if (a2 && a2.tur === 'fiyatlar') { if (!(await at(D.islemler.filter((i) => i.album === 'fiyatlar' && (esit(i.yol, x.i.yol) || esit(i.yol, ['buyuk_onay', x.i.yol[0]])))))) return; p.remove(); git({ ad: 'album', id: 'fiyatlar' }); return fiyatDuzenle(x.i.yol[0]); }
    const def = a2 && alanBul(a2.tur, x.i.yol);
    if (!def || !(await at([x.i]))) return;
    p.remove(); ciz(); alanDuzenle(a2, def, x.i.yeni); // güncel halin üzerine, sizin metninizle açılır; kaydedince yeni değişiklik olur
  });
  if ($('#cikar', p)) $('#cikar', p).onclick = async () => {
    if (await at(diger.map((x) => x.i), diger.filter((x) => x.i.tur === 'ekle').map((x) => x.i.gorsel))) { p.remove(); ciz(); if (D.islemler.length && !cakisan.length) yayinOnay(); }
  };
}

// Sonucu belirsiz kalmış bir yayın varsa (bağlantı kopmuştu) önce onu netleştirir.
async function bekleyenYayiniDogrula() {
  let b = null; try { b = JSON.parse(localStorage.getItem(BEKLEYEN) || 'null'); } catch (_) {}
  if (!b) return;
  try {
    if (b.kaydedildi || await daldaMi(b.sha)) { await yayinBasarili(b.sha); bildir('Önceki yayınınız başarıyla kaydedilmiş ✓', 4000); yayinIzle(); }
    else { localStorage.removeItem(BEKLEYEN); D.sonYayin = null; bildir('Önceki yayın gerçekleşmemiş; değişiklikleriniz hâlâ hazır.', 5000); }
  } catch (_) { D.sonYayin = { sha: b.sha, zaman: b.zaman, durum: 'belirsiz' }; }
}

// Sitedeki sürüm dosyası ve GitHub'daki Netlify durumu izlenir: "kaydedildi" ile "sitede yayında" ayrı gösterilir.
let izleniyor = false;
async function yayinIzle() {
  const y = D.sonYayin; if (!y || y.durum !== 'hazirlaniyor' || izleniyor) return;
  izleniyor = true;
  try {
    for (let n = 0; n < 50 && D.sonYayin === y && y.durum === 'hazirlaniyor'; n++) {
      await bekle(n < 6 ? 10000 : 20000);
      try {
        const s = await fetch('/yonetim/surum.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => r.ok ? r.json() : {}).catch(() => ({}));
        if (s.commit === y.sha) { y.durum = 'yayinda'; break; }
        if (s.commit && /^[0-9a-f]{40}$/.test(s.commit)) {
          // Sitede daha yeni bir sürüm varsa ve bizim kaydımızı içeriyorsa değişiklikler de yayındadır.
          const c = await gh(`/repos/${REPO}/compare/${y.sha}...${s.commit}`).catch(() => null);
          if (c && c.status === 'ahead') { y.durum = 'yayinda'; break; }
        }
        const st = await gh(`/repos/${REPO}/commits/${y.sha}/status`).catch(() => null);
        const nl = st && st.statuses && st.statuses.find((x) => /netlify/i.test(x.context) && /deploy/i.test(x.context));
        if (nl && (nl.state === 'failure' || nl.state === 'error')) { y.durum = 'hata'; break; }
      } catch (_) { /* bağlantı yoksa sonra tekrar dene */ }
    }
    if (y.durum === 'hazirlaniyor') y.durum = 'bilinmiyor';
    if (y.durum === 'yayinda') D.onizleme = {};
    localStorage.setItem('ipl_son_yayin', JSON.stringify(y));
    if (y.durum === 'yayinda') bildir(`Siteniz güncellendi ✓ (${(y.sayfalar || []).length} sayfa)`, 4000);
    if (!document.querySelector('.perde')) ciz();
  } finally { izleniyor = false; }
}

// ---------- gezinme ----------
function git(e, degistir) {
  D.ekran = e;
  if (degistir) history.replaceState(e, ''); else history.pushState(e, '');
  ciz(); window.scrollTo(0, 0);
}
addEventListener('popstate', (ev) => {
  if (yayinSuruyor) { history.pushState(D.ekran, ''); return; } // yayın sürerken geri hareketi engellenir
  D.ekran = ev.state || { ad: 'ana' }; document.querySelectorAll('.perde').forEach((p) => p.remove()); ciz();
});
addEventListener('beforeunload', (e) => { if (yayinSuruyor) { e.preventDefault(); e.returnValue = ''; } });

// ---------- başlangıç ----------
async function basla() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('hata')) D.girisHatasi = h.get('hata');
  if (location.hash) history.replaceState(null, '', '/yonetim/');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/yonetim/sw.js', { scope: '/yonetim/' }).catch(() => {});
  try {
    D.islemler = (await DB.al('kv', 'islemler')) || [];
    D.sonKullanilan = (await DB.al('kv', 'sonKullanilan')) || [];
    for (const i of D.islemler) for (const k of [...(i.tur === 'ekle' && !i.tasindi ? [i.gorsel] : []), ...islemDosyalari(i)]) { const b = await DB.al('dosya', k); if (b) D.onizleme[k] = URL.createObjectURL(b); }
  } catch (_) { D.kayitHatasi = true; }
  try { D.sonYayin = JSON.parse(localStorage.getItem('ipl_son_yayin') || 'null'); } catch (_) {}
  if (D.sonYayin && D.sonYayin.durum !== 'hazirlaniyor') D.sonYayin = null;
  history.replaceState({ ad: 'ana' }, '');
  yukleniyorEkrani();
  try {
    await gh('/user'); D.giris = true;
    await bekleyenYayiniDogrula();
    const { sha: ilkSha, dosyalar } = await icerikOku();
    D.sha = ilkSha;
    D.albumler = albumleriKur(dosyalar);
    ciz();
    if (D.sonYayin && D.sonYayin.durum === 'hazirlaniyor') yayinIzle();
  } catch (e) {
    if (e.oturum) return ciz();
    kok.innerHTML = `<div class="ust"><h1>IstanbulPrintLab</h1></div><div class="hata-kutu">Site içeriği okunamadı: ${kacir(e.message)}</div>
      <button class="buyuk-ekle" id="tekrar">Tekrar dene</button>`;
    $('#tekrar').onclick = () => location.reload();
  }
}
basla();
})();
