/* IstanbulPrintLab Yönetim — telefondan fotoğraf yönetimi.
   Akış: Fotoğraf ekle → nereye → açıklama → hazır; değişiklikler telefonda birikir; tek "Yayınla" = tek commit = tek yayın.
   Kalıcı silme yok: "Siteden kaldır" fotoğrafı sayfadan çıkarır, dosya arşivde kalır. */
(() => {
'use strict';

const REPO = 'karanerdogan34/istanbulprintlab-site';
const DAL = 'main';
const SITE = 'https://www.istanbulprintlab.com';
const API = 'https://api.github.com';
const UZUN_KENAR = 2000;

// ---------- küçük yardımcılar ----------
const $ = (s, k = document) => k.querySelector(s);
const kok = $('#uygulama');
const kacir = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
function bildir(m, sure = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t);
  setTimeout(() => t.remove(), sure);
}
function slug(s) {
  return String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'foto';
}
function b64(str) { return btoa(unescape(encodeURIComponent(str))); }
function blobB64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
}

// ---------- kalıcı taslak (IndexedDB) ----------
const DB = (() => {
  let db;
  const ac = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
    const r = indexedDB.open('ipl-yonetim', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('dosya'); };
    r.onsuccess = () => { db = r.result; res(db); }; r.onerror = () => rej(r.error);
  });
  const islem = (depo, mod, f) => ac().then((d) => new Promise((res, rej) => {
    const t = d.transaction(depo, mod); const istek = f(t.objectStore(depo));
    t.oncomplete = () => res(istek ? istek.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
  return {
    al: (depo, k) => islem(depo, 'readonly', (s) => s.get(k)),
    koy: (depo, k, v) => islem(depo, 'readwrite', (s) => { s.put(v, k); }),
    sil: (depo, k) => islem(depo, 'readwrite', (s) => { s.delete(k); }),
    temizle: (depo) => islem(depo, 'readwrite', (s) => { s.clear(); }),
  };
})();

// ---------- durum ----------
const D = {
  anahtar: null,        // GitHub erişim anahtarı (yalnız bu telefonda)
  albumler: [],         // {id, tur, ad, yol, alt, veri}
  islemler: [],         // bekleyen değişiklikler (taslak)
  onizleme: {},         // yerel fotoğraf id → blob URL
  sonYayin: null,       // {sha, zaman, durum}
  ekran: { ad: 'ana' },
  ara: '',
  sonKullanilan: [],
};

function anahtariOku() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('anahtar')) {
    localStorage.setItem('ipl_anahtar', h.get('anahtar'));
    history.replaceState(null, '', '/yonetim/');
  } else if (h.get('hata')) {
    D.girisHatasi = h.get('hata');
    history.replaceState(null, '', '/yonetim/');
  }
  D.anahtar = localStorage.getItem('ipl_anahtar');
}

async function gh(yol, ayar = {}) {
  const r = await fetch(API + yol, {
    ...ayar,
    headers: { Authorization: 'Bearer ' + D.anahtar, Accept: 'application/vnd.github+json', ...(ayar.body ? { 'Content-Type': 'application/json' } : {}), ...(ayar.headers || {}) },
    cache: 'no-store',
  });
  if (r.status === 401) { localStorage.removeItem('ipl_anahtar'); D.anahtar = null; throw Object.assign(new Error('Oturumun süresi doldu. Değişiklikleriniz telefonda duruyor; tekrar giriş yapın.'), { oturum: true }); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.message || ('GitHub hatası ' + r.status)), { durum: r.status }); }
  return r.status === 204 ? null : r.json();
}

// ---------- içerik okuma ----------
// Bütün içerik tek GraphQL isteğiyle okunur.
async function icerikOku(ref = DAL) {
  const [sahip, ad] = REPO.split('/');
  const q = `query($o:String!,$n:String!,$e1:String!,$e2:String!,$e3:String!){repository(owner:$o,name:$n){
    p:object(expression:$e1){...on Blob{text oid}}
    s:object(expression:$e2){...on Tree{entries{name object{...on Blob{text oid}}}}}
    v:object(expression:$e3){...on Tree{entries{name object{...on Blob{text oid}}}}}
    ref(qualifiedName:"refs/heads/${DAL}"){target{oid}}}}`;
  const j = await gh('/graphql', { method: 'POST', body: JSON.stringify({ query: q, variables: { o: sahip, n: ad, e1: ref + ':content/projeler.json', e2: ref + ':content/sayfalar', e3: ref + ':content/vakalar' } }) });
  if (j.errors) throw new Error(j.errors[0].message);
  const r = j.data.repository;
  const dosyalar = { 'content/projeler.json': r.p.text };
  for (const e of (r.s?.entries || [])) if (e.name.endsWith('.json')) dosyalar['content/sayfalar/' + e.name] = e.object.text;
  for (const e of (r.v?.entries || [])) if (e.name.endsWith('.json')) dosyalar['content/vakalar/' + e.name] = e.object.text;
  return { sha: r.ref.target.oid, dosyalar };
}

// Albüm tanımları: her biri bir JSON dosyasındaki fotoğraf listesi.
function albumleriKur(dosyalar) {
  const A = [];
  const pj = JSON.parse(dosyalar['content/projeler.json']);
  A.push({ id: 'projeler', tur: 'projeler', ad: 'Yaptığımız İşler', aciklama: 'Anasayfadaki proje kartları', yol: 'content/projeler.json', alan: 'projeler', klasor: 'projeler', sayfa: '/#projeler', veri: pj });
  for (const [yol, txt] of Object.entries(dosyalar)) {
    if (!yol.startsWith('content/vakalar/')) continue;
    const v = JSON.parse(txt);
    A.push({ id: yol, tur: 'vaka', ad: v.firma || v.baslik || yol, aciklama: 'Vaka çalışması', yol, alan: 'kareler', klasor: 'vakalar', sayfa: '/projeler/' + (v.slug || '') + '/', veri: v });
  }
  for (const [yol, txt] of Object.entries(dosyalar)) {
    if (!yol.startsWith('content/sayfalar/')) continue;
    const v = JSON.parse(txt);
    const en = /^en\//.test(v.yol || '') || yol.includes('/en-');
    A.push({ id: yol, tur: 'sayfa', ad: v.baslik || yol, aciklama: en ? 'Ürün sayfası (İngilizce)' : 'Ürün sayfası', en, yol, alan: 'fotolar', klasor: 'urunler', sayfa: '/' + (v.yol || '') + '/', veri: v });
  }
  return A;
}

function liste(al) { const v = al.veri[al.alan]; return Array.isArray(v) ? v : (al.veri[al.alan] = []); }
function fotoAciklama(al, x) { return al.tur === 'projeler' ? (x.baslik || '') : (x.aciklama || ''); }

// ---------- bekleyen değişiklikleri uygulama ----------
// İşlemler fotoğraf yoluna (gorsel) göre tanımlanır; yayından hemen önce GitHub'daki en güncel içeriğe yeniden uygulanır.
function islemUygula(al, i, uyarilar) {
  const L = liste(al);
  const bul = () => L.findIndex((x) => x.gorsel === i.gorsel);
  if (i.tur === 'ekle') {
    if (bul() >= 0) return;
    const yeni = al.tur === 'projeler'
      ? { baslik: i.baslik || '', etiket: i.etiket || '', aciklama: i.kisa || '', gorsel: i.gorsel, alt: i.alt || '', baglanti: '' }
      : { gorsel: i.gorsel, aciklama: i.aciklama || '' };
    if (al.tur === 'projeler') L.unshift(yeni); else L.push(yeni);
    return;
  }
  const n = bul();
  if (n < 0) { uyarilar && uyarilar.push(al.ad + ': bir fotoğraf bu arada başka yerden değiştirilmiş, o değişiklik atlandı.'); return; }
  const x = L[n];
  if (i.tur === 'duzenle') {
    if (al.tur === 'projeler') { x.baslik = i.baslik; x.aciklama = i.kisa; if (i.etiket !== undefined) x.etiket = i.etiket; }
    else x.aciklama = i.aciklama;
  } else if (i.tur === 'basa') { L.splice(n, 1); L.unshift(x); }
  else if (i.tur === 'tasi') { const m = Math.max(0, Math.min(L.length - 1, n + i.yon)); L.splice(n, 1); L.splice(m, 0, x); }
  else if (i.tur === 'gizle') { x.gizle = !!i.deger; }
  else if (i.tur === 'kaldir') { L.splice(n, 1); }
  else if (i.tur === 'kapak' && al.tur === 'vaka') { al.veri.kapak = x.gorsel; al.veri.kapak_aciklama = x.aciklama || al.veri.kapak_aciklama || ''; }
}

function gorunenAlbum(al) {
  // Albümün ekranda görünen hali = GitHub'daki içerik + bekleyen işlemler.
  const kopya = { ...al, veri: JSON.parse(JSON.stringify(al.veri)) };
  for (const i of D.islemler) if (i.album === al.id) islemUygula(kopya, i);
  return kopya;
}
function bekleyenSayisi(alId) { return D.islemler.filter((i) => !alId || i.album === alId).length; }

async function taslakKaydet() {
  try { await DB.koy('kv', 'islemler', D.islemler); await DB.koy('kv', 'sonKullanilan', D.sonKullanilan); }
  catch (e) { bildir('Uyarı: taslak telefona kaydedilemedi. Uygulamayı kapatmadan yayınlayın.', 5000); }
}

function resimAdresi(g) {
  if (D.onizleme[g]) return D.onizleme[g];
  return SITE + g;
}

// ---------- fotoğraf küçültme (telefonda) ----------
async function kucult(dosya) {
  const url = URL.createObjectURL(dosya);
  try {
    const img = new Image(); img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Bu fotoğraf açılamadı (desteklenmeyen biçim).')); img.src = url; });
    const o = Math.min(1, UZUN_KENAR / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * o), h = Math.round(img.naturalHeight * o);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h); // tarayıcı telefonun döndürme bilgisini uygular; konum gibi bilgiler dosyaya yazılmaz
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.84));
    c.width = c.height = 0;
    if (!blob) throw new Error('Fotoğraf hazırlanamadı.');
    return { blob, w, h };
  } finally { URL.revokeObjectURL(url); }
}

// ---------- ekranlar ----------
function ciz() {
  const e = D.ekran;
  if (!D.anahtar) return girisEkrani();
  if (!D.albumler.length) return yukleniyorEkrani();
  if (e.ad === 'album') return albumEkrani(e.id);
  return anaEkran();
}

function girisEkrani() {
  kok.innerHTML = `<div class="giris">
    <h1>IstanbulPrintLab</h1><p>Site yönetimi</p>
    ${D.girisHatasi ? `<div class="hata-kutu">${kacir(D.girisHatasi)}</div>` : ''}
    <a class="buyuk-ekle" href="/.netlify/functions/giris">Giriş yap</a>
    <p class="kucuk-not">Bir kez giriş yapmanız yeterli; bu telefon sizi hatırlar.</p>
  </div>`;
}
function yukleniyorEkrani(m) {
  kok.innerHTML = `<div class="ust"><h1>IstanbulPrintLab</h1></div><div class="aciklama-not">${kacir(m || 'Siteniz yükleniyor…')}</div>`;
}

function durumSatiri() {
  const y = D.sonYayin;
  if (y && y.durum === 'hazirlaniyor') return `<div class="durum bekle">⏳ Değişiklikler kaydedildi, site hazırlanıyor (1–2 dakika)…</div>`;
  if (y && y.durum === 'yayinda') return `<div class="durum iyi">✓ Son değişiklikleriniz sitede yayında.</div>`;
  if (y && y.durum === 'hata') return `<div class="durum hata">Site güncellenemedi; sitenin eski hali yayında duruyor. Size e-posta da gitti. Değişiklikleriniz GitHub'da kayıtlı.</div>`;
  const n = bekleyenSayisi();
  return n ? `<div class="durum bekle">${n} değişiklik henüz yayında değil.</div>` : `<div class="durum iyi">✓ Siteniz güncel.</div>`;
}

function albumSatiri(al) {
  const g = gorunenAlbum(al); const L = liste(g).filter((x) => x.gorsel);
  const kapak = al.tur === 'vaka' ? (g.veri.kapak || L[0]?.gorsel) : L[0]?.gorsel;
  const n = bekleyenSayisi(al.id);
  return `<li><button class="satir" data-album="${kacir(al.id)}">
    ${kapak ? `<img loading="lazy" src="${kacir(resimAdresi(kapak))}" alt="">` : '<span class="bos"></span>'}
    <span class="ad"><b>${kacir(al.ad)}</b><small>${kacir(al.aciklama)} · ${L.length} fotoğraf</small></span>
    ${n ? `<span class="rozet">${n}</span>` : ''}</button></li>`;
}

function anaEkran() {
  const q = D.ara.toLocaleLowerCase('tr');
  const uy = (a) => !q || a.ad.toLocaleLowerCase('tr').includes(q);
  const grup = (tur, baslik) => {
    const A = D.albumler.filter((a) => a.tur === tur && uy(a));
    return A.length ? `<div class="bolum">${baslik}</div><ul class="liste">${A.map(albumSatiri).join('')}</ul>` : '';
  };
  kok.innerHTML = `<div class="ust"><h1>IstanbulPrintLab</h1><a class="dugme ust-baglanti" href="${SITE}" target="_blank" rel="noopener">Siteyi aç</a></div>
    ${durumSatiri()}
    <button class="buyuk-ekle" id="ekle"><span>+</span> Fotoğraf ekle</button>
    <input class="ara" id="ara" type="search" placeholder="Sayfa ara (ör. sticker, branda)" value="${kacir(D.ara)}">
    ${grup('projeler', 'Anasayfa')}${grup('vaka', 'Vaka çalışmaları')}${grup('sayfa', 'Ürün sayfaları')}
    <div class="alt-bilgi"><button id="cikis">Bu telefondan çıkış yap</button></div>`;
  $('#ekle').onclick = () => fotoSec(null);
  const ara = $('#ara'); ara.oninput = () => { D.ara = ara.value; const p = ara.selectionStart; anaEkran(); const a2 = $('#ara'); a2.focus(); a2.setSelectionRange(p, p); };
  kok.querySelectorAll('[data-album]').forEach((b) => b.onclick = () => git({ ad: 'album', id: b.dataset.album }));
  $('#cikis').onclick = () => { if (confirm('Bu telefondan çıkış yapılsın mı? Yayınlanmamış değişiklikler telefonda kalır.')) { localStorage.removeItem('ipl_anahtar'); D.anahtar = null; ciz(); } };
  yayinCubugu();
}

function albumEkrani(id) {
  const al = D.albumler.find((a) => a.id === id); if (!al) return git({ ad: 'ana' });
  const g = gorunenAlbum(al); const L = liste(g);
  const yeniler = new Set(D.islemler.filter((i) => i.album === id && i.tur === 'ekle').map((i) => i.gorsel));
  const ilkEtiket = al.tur === 'sayfa' ? 'Büyük görsel' : al.tur === 'projeler' ? 'İlk kart' : '';
  kok.innerHTML = `<div class="ust"><button class="geri" id="geri" aria-label="Geri">‹</button><h1>${kacir(al.ad)}</h1>
      <a class="dugme ust-baglanti" href="${SITE + al.sayfa}" target="_blank" rel="noopener">Sayfayı aç</a></div>
    <div class="aciklama-not">${al.tur === 'sayfa' ? 'İlk fotoğraf sayfada büyük görsel olarak görünür.' : al.tur === 'projeler' ? 'Her fotoğraf anasayfada bir proje kartıdır. Yeni eklenen en başa gelir.' : 'Vaka sayfasındaki “Uygulamadan kareler” bölümü.'} Bir fotoğrafa dokunarak düzenleyin.</div>
    <div class="izgara">${L.map((x, n) => !x.gorsel ? '' : `<button class="kare ${x.gizle ? 'soluk' : ''}" data-g="${kacir(x.gorsel)}">
        <img loading="lazy" src="${kacir(resimAdresi(x.gorsel))}" alt="">
        ${yeniler.has(x.gorsel) ? '<span class="etiket yeni">Yayında değil</span>' : x.gizle ? '<span class="etiket gizli">Gizli</span>' : (n === 0 && ilkEtiket ? `<span class="etiket">${ilkEtiket}</span>` : '')}
      </button>`).join('')}</div>
    ${L.length ? '' : '<div class="aciklama-not">Bu sayfada henüz fotoğraf yok. + düğmesiyle ekleyin.</div>'}
    <button class="fab" id="fab" aria-label="Fotoğraf ekle">+</button>`;
  $('#geri').onclick = () => history.back();
  $('#fab').onclick = () => fotoSec(id);
  kok.querySelectorAll('.kare').forEach((b) => b.onclick = () => fotoDetay(al, b.dataset.g));
  kok.querySelectorAll('.kare img').forEach((im) => im.onerror = () => { if (!im.dataset.yedek) { im.dataset.yedek = 1; im.src = `https://raw.githubusercontent.com/${REPO}/${DAL}/site${im.closest('.kare').dataset.g}`; } });
  yayinCubugu();
}

function yayinCubugu() {
  const n = bekleyenSayisi();
  const eski = $('.yayin-cubugu'); if (eski) eski.remove();
  if (!n) return;
  const c = document.createElement('div'); c.className = 'yayin-cubugu';
  c.innerHTML = `<div class="bilgi"><b>${n} değişiklik hazır</b>Henüz sitede değil</div>
    <button class="dugme" id="vazgec">Vazgeç</button><button class="dugme ana" id="yayinla">Yayınla</button>`;
  kok.appendChild(c);
  $('#yayinla').onclick = yayinOnay;
  $('#vazgec').onclick = async () => {
    if (!confirm('Henüz yayınlanmamış ' + n + ' değişiklik silinsin mi?')) return;
    D.islemler = []; await DB.temizle('dosya'); await taslakKaydet(); ciz();
  };
}

function perde(icerik, kapaninca) {
  const p = document.createElement('div'); p.className = 'perde';
  p.innerHTML = `<div class="sayfa" role="dialog" aria-modal="true"><div class="tutamak"></div>${icerik}</div>`;
  p.onclick = (e) => { if (e.target === p) { p.remove(); kapaninca && kapaninca(); } };
  document.body.appendChild(p);
  return p;
}

// ---------- fotoğraf ekleme akışı ----------
function fotoSec(albumId) {
  const inp = $('#dosya'); inp.value = '';
  inp.onchange = () => { const F = [...inp.files]; if (F.length) hedefSec(F, albumId); };
  inp.click();
}

function hedefSec(F, albumId) {
  if (albumId) return eklemeFormu(F, D.albumler.find((a) => a.id === albumId));
  const onceki = D.sonKullanilan.map((id) => D.albumler.find((a) => a.id === id)).filter(Boolean);
  const satir = (a) => `<li><button class="satir" data-h="${kacir(a.id)}"><span class="ad"><b>${kacir(a.ad)}</b><small>${kacir(a.aciklama)}</small></span></button></li>`;
  const p = perde(`<h2>${F.length} fotoğraf · Nereye eklensin?</h2>
    <input class="ara perde-ara" id="hara" type="search" placeholder="Sayfa ara">
    <ul class="liste" id="hliste"></ul>`);
  const doldur = (q) => {
    q = (q || '').toLocaleLowerCase('tr');
    const tum = D.albumler.filter((a) => !q || a.ad.toLocaleLowerCase('tr').includes(q));
    const ust = q ? [] : onceki;
    $('#hliste', p).innerHTML = (ust.length ? '<div class="bolum perde-bolum">Son kullanılanlar</div>' + ust.map(satir).join('') + '<div class="bolum perde-bolum">Tüm sayfalar</div>' : '') + tum.map(satir).join('');
    p.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { p.remove(); eklemeFormu(F, D.albumler.find((a) => a.id === b.dataset.h)); });
  };
  doldur(''); $('#hara', p).oninput = (e) => doldur(e.target.value);
}

async function eklemeFormu(F, al) {
  const p = perde(`<h2>Fotoğraflar hazırlanıyor…</h2><div class="ilerleme"><i id="ilr"></i></div><div class="aciklama-not perde-not" id="ilm"></div>`);
  const hazir = [];
  for (let n = 0; n < F.length; n++) {
    $('#ilm', p).textContent = (n + 1) + ' / ' + F.length;
    try { hazir.push(await kucult(F[n])); }
    catch (e) { bildir(F[n].name + ': ' + e.message, 5000); }
    $('#ilr', p).style.width = Math.round(((n + 1) / F.length) * 100) + '%';
  }
  p.remove();
  if (!hazir.length) return;
  for (const h of hazir) h.url = URL.createObjectURL(h.blob);
  const proje = al.tur === 'projeler';
  const kart = (h, n) => `<div class="ekle-kart">
    <img class="onizleme" src="${h.url}" alt="">
    ${proje ? `<label class="alan"><span>Başlık (firma / proje)</span><input data-n="${n}" data-k="baslik" placeholder="Örn. Antre Gourmet"></label>
               <label class="alan"><span>Kısa açıklama (ne yapıldı?)</span><input data-n="${n}" data-k="kisa" placeholder="Örn. Cam vitrine folyo kesim yazı"></label>`
            : `<label class="alan"><span>Kısa açıklama (ne görünüyor?)</span><input data-n="${n}" data-k="aciklama" placeholder="Örn. ${kacir(al.ad)} uygulaması"></label>`}
  </div>`;
  const f = perde(`<h2>${kacir(al.ad)}</h2>
    <div class="aciklama-not perde-not">Açıklama Google'da ve görme engelli ziyaretçiler için kullanılır. Kısa yazmanız yeterli.</div>
    ${hazir.map(kart).join('')}
    <button class="dugme ana tam" id="hazir">${hazir.length > 1 ? hazir.length + ' fotoğrafı ekle' : 'Ekle'}</button>
    <button class="dugme tam ara-bosluk" id="iptal">Vazgeç</button>`, () => hazir.forEach((h) => URL.revokeObjectURL(h.url)));
  $('#iptal', f).onclick = () => { hazir.forEach((h) => URL.revokeObjectURL(h.url)); f.remove(); };
  $('#hazir', f).onclick = async () => {
    const deger = (n, k) => ($(`[data-n="${n}"][data-k="${k}"]`, f)?.value || '').trim();
    if (proje && hazir.some((_, n) => !deger(n, 'baslik'))) { bildir('Her proje kartı için bir başlık yazın.'); return; }
    const zaman = new Date(); const damga = zaman.toISOString().slice(0, 19).replace(/[-:T]/g, '');
    for (let n = 0; n < hazir.length; n++) {
      const h = hazir[n];
      const ad = `${slug(al.tur === 'projeler' ? deger(n, 'baslik') : al.ad)}-${damga}-${Math.random().toString(36).slice(2, 6)}.jpg`;
      const gorsel = `/img/yuklenen/${al.klasor}/${ad}`;
      await DB.koy('dosya', gorsel, h.blob);
      D.onizleme[gorsel] = h.url;
      const i = { tur: 'ekle', album: al.id, gorsel };
      if (proje) { i.baslik = deger(n, 'baslik'); i.kisa = deger(n, 'kisa'); i.alt = [i.baslik, i.kisa].filter(Boolean).join(' — '); }
      else i.aciklama = deger(n, 'aciklama') || al.ad;
      D.islemler.push(i);
    }
    D.sonKullanilan = [al.id, ...D.sonKullanilan.filter((x) => x !== al.id)].slice(0, 5);
    await taslakKaydet();
    f.remove();
    bildir(hazir.length + ' fotoğraf eklendi. Hazır olunca “Yayınla”ya basın.');
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
               <label class="alan"><span>Kısa açıklama</span><input id="d2" value="${kacir(x.aciklama)}"></label>`
            : `<label class="alan"><span>Kısa açıklama</span><input id="d1" value="${kacir(x.aciklama)}"></label>`}
    <div class="dugmeler">
      <button class="dugme" id="kaydet">Açıklamayı kaydet</button>
      <button class="dugme" id="basa" ${n === 0 ? 'disabled' : ''}>${al.tur === 'sayfa' ? 'Büyük görsel yap' : 'En başa al'}</button>
      <button class="dugme" id="sol" ${n === 0 ? 'disabled' : ''}>◀ Öne</button>
      <button class="dugme" id="sag" ${n === L.length - 1 ? 'disabled' : ''}>Arkaya ▶</button>
      ${al.tur === 'vaka' ? `<button class="dugme tam" id="kapak">Sayfanın kapak fotoğrafı yap</button>` : ''}
      ${proje ? `<button class="dugme tam" id="gizle">${x.gizle ? 'Sitede göster' : 'Sitede gizle (silinmez)'}</button>` : ''}
      <button class="dugme tehlike tam" id="kaldir">Siteden kaldır</button>
    </div>`);
  const ekle = async (i, mesaj) => { D.islemler.push({ album: al.id, gorsel, ...i }); await taslakKaydet(); p.remove(); if (mesaj) bildir(mesaj); ciz(); };
  $('#kaydet', p).onclick = () => proje ? ekle({ tur: 'duzenle', baslik: $('#d1', p).value.trim(), kisa: $('#d2', p).value.trim() }, 'Kaydedildi') : ekle({ tur: 'duzenle', aciklama: $('#d1', p).value.trim() }, 'Kaydedildi');
  $('#basa', p).onclick = () => ekle({ tur: 'basa' });
  $('#sol', p).onclick = () => ekle({ tur: 'tasi', yon: -1 });
  $('#sag', p).onclick = () => ekle({ tur: 'tasi', yon: 1 });
  if ($('#kapak', p)) $('#kapak', p).onclick = () => ekle({ tur: 'kapak' }, 'Kapak olarak işaretlendi');
  if ($('#gizle', p)) $('#gizle', p).onclick = () => ekle({ tur: 'gizle', deger: !x.gizle });
  $('#kaldir', p).onclick = async () => {
    if (!confirm('Bu fotoğraf sayfadan kaldırılsın mı? (Dosya arşivde kalır, isterseniz geri eklenebilir.)')) return;
    // Henüz yayınlanmamış yeni bir fotoğrafsa taslaktan tamamen çıkar.
    const yeni = D.islemler.find((i) => i.album === al.id && i.tur === 'ekle' && i.gorsel === gorsel);
    if (yeni) { D.islemler = D.islemler.filter((i) => !(i.album === al.id && i.gorsel === gorsel)); await DB.sil('dosya', gorsel); await taslakKaydet(); p.remove(); ciz(); return; }
    ekle({ tur: 'kaldir' }, 'Kaldırıldı');
  };
}

// ---------- yayınlama ----------
function ozet() {
  const say = {};
  for (const i of D.islemler) {
    const al = D.albumler.find((a) => a.id === i.album); const k = al ? al.ad : i.album;
    say[k] = say[k] || { ekle: 0, diger: 0 }; i.tur === 'ekle' ? say[k].ekle++ : say[k].diger++;
  }
  return Object.entries(say).map(([k, v]) => `<li><b>${kacir(k)}</b>: ${[v.ekle ? v.ekle + ' yeni fotoğraf' : '', v.diger ? v.diger + ' düzenleme' : ''].filter(Boolean).join(', ')}</li>`).join('');
}

function yayinOnay() {
  const p = perde(`<h2>Siteye yayınlansın mı?</h2><ul class="ozet">${ozet()}</ul>
    <div class="aciklama-not perde-not2">Hepsi tek seferde yayınlanır. Site 1–2 dakika içinde güncellenir.</div>
    <button class="dugme ana tam" id="evet">Yayınla</button><button class="dugme tam ara-bosluk" id="hayir">Vazgeç</button>`);
  $('#hayir', p).onclick = () => p.remove();
  $('#evet', p).onclick = () => { p.remove(); yayinla(); };
}

let yayinSuruyor = false;
async function yayinla() {
  if (yayinSuruyor || !D.islemler.length) return;
  yayinSuruyor = true;
  const p = perde(`<h2>Yayınlanıyor…</h2><div class="ilerleme"><i id="yi"></i></div><div class="aciklama-not perde-not" id="ym">Hazırlanıyor</div>`);
  const adim = (yuzde, m) => { $('#yi', p).style.width = yuzde + '%'; $('#ym', p).textContent = m; };
  try {
    for (let deneme = 1; deneme <= 3; deneme++) {
      adim(5, 'Sitenin güncel hali alınıyor');
      const { sha, dosyalar } = await icerikOku(DAL);
      const anlik = albumleriKur(dosyalar);
      const uyarilar = []; const degisen = new Set();
      for (const i of D.islemler) { const al = anlik.find((a) => a.id === i.album); if (!al) { uyarilar.push('Bir sayfa bulunamadı, değişikliği atlandı.'); continue; } islemUygula(al, i, uyarilar); degisen.add(al); }
      const agac = [];
      const yeniler = D.islemler.filter((i) => i.tur === 'ekle');
      for (let n = 0; n < yeniler.length; n++) {
        adim(10 + Math.round((n / Math.max(1, yeniler.length)) * 70), `Fotoğraf yükleniyor ${n + 1} / ${yeniler.length}`);
        const blob = await DB.al('dosya', yeniler[n].gorsel);
        if (!blob) { uyarilar.push('Bir fotoğrafın dosyası telefonda bulunamadı, atlandı.'); continue; }
        const b = await gh(`/repos/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: await blobB64(blob), encoding: 'base64' }) });
        agac.push({ path: 'site' + yeniler[n].gorsel, mode: '100644', type: 'blob', sha: b.sha });
      }
      adim(85, 'Sayfalar güncelleniyor');
      for (const al of degisen) {
        const yeni = JSON.stringify(al.veri, null, 2) + '\n';
        if (yeni === dosyalar[al.yol] || yeni.trim() === (dosyalar[al.yol] || '').trim()) continue;
        agac.push({ path: al.yol, mode: '100644', type: 'blob', content: yeni });
      }
      if (!agac.length) { D.islemler = []; await DB.temizle('dosya'); await taslakKaydet(); p.remove(); bildir('Yayınlanacak değişiklik kalmadı.'); return ciz(); }
      const commit = await gh(`/repos/${REPO}/git/commits/${sha}`);
      const tree = await gh(`/repos/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: agac }) });
      const c = await gh(`/repos/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `Yönetim uygulaması: ${D.islemler.length} değişiklik`, tree: tree.sha, parents: [sha] }) });
      adim(95, 'Kaydediliyor');
      try {
        await gh(`/repos/${REPO}/git/refs/heads/${DAL}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha, force: false }) });
      } catch (e) {
        if (e.durum === 422 && deneme < 3) { adim(5, 'Site bu arada güncellenmiş, yeniden deneniyor'); await bekle(1500); continue; }
        throw e;
      }
      // Başarılı: taslağı temizle, durumu izlemeye başla.
      const yerel = { ...D.onizleme };
      D.islemler = []; await DB.temizle('dosya'); await taslakKaydet();
      D.sonYayin = { sha: c.sha, zaman: Date.now(), durum: 'hazirlaniyor' };
      localStorage.setItem('ipl_son_yayin', JSON.stringify(D.sonYayin));
      // içerik yeniden okunur; önizlemeler site yayına girene kadar yerel kalır
      D.albumler = albumleriKur((await icerikOku(c.sha)).dosyalar);
      D.onizleme = yerel;
      p.remove();
      if (uyarilar.length) bildir(uyarilar[0], 6000);
      ciz(); yayinIzle();
      return;
    }
  } catch (e) {
    p.remove();
    if (e.oturum) { ciz(); bildir(e.message, 6000); }
    else perde(`<h2>Yayınlanamadı</h2><div class="hata-kutu bosluksuz">${kacir(e.message)}</div><div class="aciklama-not perde-not2">Değişiklikleriniz telefonda duruyor. İnternet bağlantınızı kontrol edip tekrar deneyin.</div><button class="dugme ana tam" id="tamam">Tamam</button>`);
    const t = $('#tamam'); if (t) t.onclick = () => t.closest('.perde').remove();
  } finally { yayinSuruyor = false; }
}

// GitHub'daki Netlify durumunu ve sitedeki sürüm dosyasını izler: "kaydedildi" ile "sitede yayında" ayrı gösterilir.
async function yayinIzle() {
  const y = D.sonYayin; if (!y || y.durum !== 'hazirlaniyor') return;
  for (let n = 0; n < 60 && D.sonYayin === y; n++) {
    await bekle(n < 6 ? 10000 : 20000);
    try {
      const s = await fetch('/yonetim/surum.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => r.ok ? r.json() : {}).catch(() => ({}));
      if (s.commit === y.sha) { y.durum = 'yayinda'; D.onizleme = {}; break; }
      const st = await gh(`/repos/${REPO}/commits/${y.sha}/status`).catch(() => null);
      const nl = st && st.statuses && st.statuses.find((x) => /netlify/i.test(x.context) && /deploy/i.test(x.context));
      if (nl && (nl.state === 'failure' || nl.state === 'error')) { y.durum = 'hata'; break; }
    } catch (_) { /* bağlantı yoksa sonra tekrar dene */ }
  }
  if (y.durum === 'hazirlaniyor' && Date.now() - y.zaman > 20 * 60000) y.durum = 'bilinmiyor';
  localStorage.setItem('ipl_son_yayin', JSON.stringify(y));
  if (y.durum === 'yayinda') bildir('Siteniz güncellendi ✓', 4000);
  ciz();
}

// ---------- gezinme ----------
function git(e, degistir) {
  D.ekran = e;
  if (degistir) history.replaceState(e, ''); else history.pushState(e, '');
  ciz(); window.scrollTo(0, 0);
}
addEventListener('popstate', (ev) => { D.ekran = ev.state || { ad: 'ana' }; document.querySelectorAll('.perde').forEach((p) => p.remove()); ciz(); });

// ---------- başlangıç ----------
async function basla() {
  anahtariOku();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/yonetim/sw.js', { scope: '/yonetim/' }).catch(() => {});
  try {
    D.islemler = (await DB.al('kv', 'islemler')) || [];
    D.sonKullanilan = (await DB.al('kv', 'sonKullanilan')) || [];
    for (const i of D.islemler) if (i.tur === 'ekle') { const b = await DB.al('dosya', i.gorsel); if (b) D.onizleme[i.gorsel] = URL.createObjectURL(b); }
  } catch (_) { bildir('Uyarı: taslak deposu açılamadı.', 5000); }
  try { D.sonYayin = JSON.parse(localStorage.getItem('ipl_son_yayin') || 'null'); } catch (_) {}
  if (D.sonYayin && D.sonYayin.durum !== 'hazirlaniyor') D.sonYayin = null;
  history.replaceState({ ad: 'ana' }, '');
  if (!D.anahtar) return ciz();
  yukleniyorEkrani();
  try {
    const { dosyalar } = await icerikOku(DAL);
    D.albumler = albumleriKur(dosyalar);
    ciz();
    if (D.sonYayin) yayinIzle();
  } catch (e) {
    if (e.oturum) return ciz();
    kok.innerHTML = `<div class="ust"><h1>IstanbulPrintLab</h1></div><div class="hata-kutu">Site içeriği okunamadı: ${kacir(e.message)}</div>
      <button class="buyuk-ekle" id="tekrar">Tekrar dene</button>`;
    $('#tekrar').onclick = () => location.reload();
  }
}
basla();
})();
