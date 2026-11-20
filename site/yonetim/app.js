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
  const [sahip, ad] = REPO.split('/');
  const q = `query($o:String!,$n:String!,$e1:String!,$e2:String!,$e3:String!){repository(owner:$o,name:$n){
    p:object(expression:$e1){...on Blob{text oid}}
    s:object(expression:$e2){...on Tree{entries{name object{...on Blob{text oid}}}}}
    v:object(expression:$e3){...on Tree{entries{name object{...on Blob{text oid}}}}}}}`;
  const j = await gh('/graphql', 'POST', { query: q, variables: { o: sahip, n: ad, e1: sha + ':content/projeler.json', e2: sha + ':content/sayfalar', e3: sha + ':content/vakalar' } });
  if (j.errors) throw new Error(j.errors[0].message);
  const r = j.data.repository;
  const dosyalar = { 'content/projeler.json': { text: r.p.text, oid: r.p.oid } };
  for (const e of (r.s?.entries || [])) if (e.name.endsWith('.json')) dosyalar['content/sayfalar/' + e.name] = e.object;
  for (const e of (r.v?.entries || [])) if (e.name.endsWith('.json')) dosyalar['content/vakalar/' + e.name] = e.object;
  return { sha, dosyalar };
}

function albumleriKur(dosyalar) {
  const A = [];
  const pj = dosyalar['content/projeler.json'];
  A.push({ id: 'projeler', tur: 'projeler', ad: 'Yaptığımız İşler', aciklama: 'Anasayfadaki proje kartları', yol: 'content/projeler.json', alan: 'projeler', klasor: 'projeler', sayfa: '/', oid: pj.oid, veri: JSON.parse(pj.text) });
  for (const [yol, d] of Object.entries(dosyalar)) {
    if (!yol.startsWith('content/vakalar/')) continue;
    const v = JSON.parse(d.text);
    A.push({ id: yol, tur: 'vaka', ad: v.firma || v.baslik || yol, aciklama: 'Vaka çalışması', yol, alan: 'kareler', klasor: 'vakalar', sayfa: '/projeler/' + (v.slug || '') + '/', oid: d.oid, veri: v });
  }
  for (const [yol, d] of Object.entries(dosyalar)) {
    if (!yol.startsWith('content/sayfalar/')) continue;
    const v = JSON.parse(d.text);
    const en = /^en\//.test(v.yol || '');
    A.push({ id: yol, tur: 'sayfa', ad: v.baslik || yol, aciklama: en ? 'Ürün sayfası (İngilizce)' : 'Ürün sayfası', yol, alan: 'fotolar', klasor: 'urunler', sayfa: '/' + (v.yol || '') + '/', oid: d.oid, veri: v });
  }
  return A;
}

function liste(al) { const v = al.veri[al.alan]; return Array.isArray(v) ? v : (al.veri[al.alan] = []); }

// ---------- bekleyen değişiklikleri uygulama ----------
// İşlemler fotoğraf yoluna (gorsel) göre tanımlanır. Yayında en güncel içeriğe yeniden uygulanır;
// "siki" modda uygulanamayan tek bir işlem bile tüm yayını durdurur.
function islemUygula(al, i, siki) {
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
    if (al.tur === 'projeler') { x.baslik = i.baslik; x.aciklama = i.kisa; x.alt = [i.baslik, i.kisa].filter(Boolean).join(' — '); }
    else x.aciklama = i.aciklama;
  } else if (i.tur === 'basa') { L.splice(n, 1); L.unshift(x); }
  else if (i.tur === 'tasi') { const m = Math.max(0, Math.min(L.length - 1, n + i.yon)); L.splice(n, 1); L.splice(m, 0, x); }
  else if (i.tur === 'gizle' && al.tur === 'projeler') { if (i.deger) x.gizle = true; else delete x.gizle; }
  else if (i.tur === 'kaldir') { L.splice(n, 1); }
  else if (i.tur === 'kapak' && al.tur === 'vaka') { al.veri.kapak = x.gorsel; al.veri.kapak_aciklama = x.aciklama || al.veri.kapak_aciklama || ''; }
}

function gorunenAlbum(al) {
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
  if (y && y.durum === 'yayinda') return `<div class="durum iyi">✓ Son değişiklikleriniz sitede yayında.</div>`;
  if (y && y.durum === 'hata') return `<div class="durum hata">Site güncellenemedi; sitenin önceki hali yayında duruyor. Size e-posta da gitti.</div>`;
  if (y && y.durum === 'bilinmiyor') return `<div class="durum bekle">Değişiklikler kaydedildi ama sitede yayına girdiği henüz doğrulanamadı. “Siteyi aç” ile kontrol edebilirsiniz.</div>`;
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
  kok.innerHTML = `<div class="ust"><h1>IstanbulPrintLab</h1><a class="dugme ust-baglanti" href="${SITE}/" target="_blank" rel="noopener">Siteyi aç</a></div>
    ${durumSatiri()}
    <button class="buyuk-ekle" id="ekle"><span>+</span> Fotoğraf ekle</button>
    <input class="ara" id="ara" type="search" placeholder="Sayfa ara (ör. sticker, branda)" value="${kacir(D.ara)}">
    ${grup('projeler', 'Anasayfa')}${grup('vaka', 'Vaka çalışmaları')}${grup('sayfa', 'Ürün sayfaları')}
    <div class="alt-bilgi"><button id="cikis">Bu telefondan çıkış yap</button></div>`;
  $('#ekle').onclick = () => fotoSec(null);
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
  const yeniler = new Set(D.islemler.filter((i) => i.album === id && i.tur === 'ekle').map((i) => i.gorsel));
  const ilkEtiket = al.tur === 'sayfa' ? 'Ana fotoğraf' : al.tur === 'projeler' ? 'İlk kart' : '';
  const kapak = al.tur === 'vaka' ? g.veri.kapak : null;
  kok.innerHTML = `<div class="ust"><button class="geri" id="geri" aria-label="Geri">‹</button><h1>${kacir(al.ad)}</h1>
      <a class="dugme ust-baglanti" href="${kacir(siteYolu(al.sayfa))}" target="_blank" rel="noopener">Sayfayı aç</a></div>
    <div class="aciklama-not">${al.tur === 'sayfa' ? 'İlk fotoğraf sayfanın en üstünde büyük görünen ana fotoğraftır.' : al.tur === 'projeler' ? 'Her fotoğraf anasayfada bir proje kartıdır. Yeni eklenen en başa gelir.' : 'Vaka sayfasındaki “Uygulamadan kareler” bölümü.'} Düzenlemek için fotoğrafa dokunun.</div>
    <div class="izgara">${L.map((x, n) => !x.gorsel ? '' : `<button class="kare ${x.gizle ? 'soluk' : ''}" data-g="${kacir(x.gorsel)}">
        <img loading="lazy" src="${kacir(resimAdresi(x.gorsel))}" alt="">
        ${yeniler.has(x.gorsel) ? '<span class="etiket yeni">Yayında değil</span>' : x.gizle ? '<span class="etiket gizli">Gizli</span>' : (x.gorsel === kapak ? '<span class="etiket">Kapak</span>' : (n === 0 && ilkEtiket ? `<span class="etiket">${ilkEtiket}</span>` : ''))}
      </button>`).join('')}</div>
    ${L.length ? '' : '<div class="aciklama-not">Bu sayfada henüz fotoğraf yok. + düğmesiyle ekleyin.</div>'}
    <button class="fab" id="fab" aria-label="Bu sayfaya fotoğraf ekle">+</button>`;
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
    <button class="dugme" id="vazgec">Geri al</button><button class="dugme ana" id="yayinla">Yayınla</button>`;
  kok.appendChild(c);
  $('#yayinla').onclick = yayinOnay;
  $('#vazgec').onclick = async () => {
    if (!confirm('Henüz yayınlanmamış ' + n + ' değişikliğin HEPSİ silinsin mi? Sitedeki hiçbir şey değişmez.')) return;
    try { await taslakYaz([], { dosyaTemizle: true }); } catch (e) { bildir(e.message, 5000); }
    ciz();
  };
}

// Alttan açılan pencere. kilitli: işlem sürerken dışına dokunarak kapatılamaz.
function perde(icerik, { kapaninca, kilitli } = {}) {
  const p = document.createElement('div'); p.className = 'perde';
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
               <label class="alan"><span>Ne yapıldı?</span><input id="d2" value="${kacir(x.aciklama)}"></label>`
            : `<label class="alan"><span>Fotoğrafta ne var?</span><input id="d1" value="${kacir(x.aciklama)}"></label>`}
    <div class="dugmeler">
      <button class="dugme tam" id="kaydet">Yazıyı kaydet</button>
      <button class="dugme tam" id="basa" ${n === 0 ? 'disabled' : ''}>${al.tur === 'sayfa' ? 'Ana fotoğraf yap (en üste)' : 'En başa al'}</button>
      <button class="dugme" id="sol" ${n === 0 ? 'disabled' : ''}>◀ Bir öne</button>
      <button class="dugme" id="sag" ${n === L.length - 1 ? 'disabled' : ''}>Bir arkaya ▶</button>
      ${al.tur === 'vaka' ? `<button class="dugme tam" id="kapak" ${g.veri.kapak === gorsel ? 'disabled' : ''}>Sayfanın kapak fotoğrafı yap</button>` : ''}
      ${proje ? `<button class="dugme tam" id="gizle">${x.gizle ? 'Anasayfada tekrar göster' : 'Anasayfada geçici gizle'}</button>` : ''}
      <button class="dugme tehlike tam" id="kaldir">Sayfadan kaldır</button>
    </div>`);
  const ekle = async (i, mesaj) => {
    try { await taslakYaz([...D.islemler, { album: al.id, gorsel, taban: al.oid, ...i }]); }
    catch (e) { p.remove(); hataPenceresi('Kaydedilemedi', e.message); return ciz(); }
    p.remove(); if (mesaj) bildir(mesaj); ciz();
  };
  $('#kaydet', p).onclick = () => proje ? ekle({ tur: 'duzenle', baslik: $('#d1', p).value.trim(), kisa: $('#d2', p).value.trim() }, 'Kaydedildi') : ekle({ tur: 'duzenle', aciklama: $('#d1', p).value.trim() }, 'Kaydedildi');
  $('#basa', p).onclick = () => ekle({ tur: 'basa' });
  $('#sol', p).onclick = () => ekle({ tur: 'tasi', yon: -1 });
  $('#sag', p).onclick = () => ekle({ tur: 'tasi', yon: 1 });
  if ($('#kapak', p)) $('#kapak', p).onclick = () => ekle({ tur: 'kapak' }, 'Kapak olarak işaretlendi');
  if ($('#gizle', p)) $('#gizle', p).onclick = () => ekle({ tur: 'gizle', deger: !x.gizle });
  $('#kaldir', p).onclick = async () => {
    if (!confirm('Bu fotoğraf sayfadan kaldırılsın mı? (Dosya arşivde kalır, istenirse geri eklenebilir.)')) return;
    // Henüz yayınlanmamış yeni bir fotoğrafsa taslaktan tamamen çıkar.
    const yeni = D.islemler.find((i) => i.album === al.id && i.tur === 'ekle' && i.gorsel === gorsel);
    if (yeni) {
      try { await taslakYaz(D.islemler.filter((i) => !(i.album === al.id && i.gorsel === gorsel)), { dosyaSil: [gorsel] }); }
      catch (e) { p.remove(); hataPenceresi('Kaydedilemedi', e.message); return ciz(); }
      p.remove(); return ciz();
    }
    ekle({ tur: 'kaldir' }, 'Kaldırıldı');
  };
}

// ---------- yayınlama ----------
function ozet() {
  const say = {};
  for (const i of D.islemler) {
    const al = D.albumler.find((a) => a.id === i.album); const k = al ? al.ad : i.album;
    say[k] = say[k] || { ekle: [], diger: 0 }; i.tur === 'ekle' ? say[k].ekle.push(i.gorsel) : say[k].diger++;
  }
  return Object.entries(say).map(([k, v]) => `<li><b>${kacir(k)}</b>: ${[v.ekle.length ? v.ekle.length + ' yeni fotoğraf' : '', v.diger ? v.diger + ' düzenleme' : ''].filter(Boolean).join(', ')}
    ${v.ekle.length ? `<div class="secim-ust">${v.ekle.map((g) => `<img src="${kacir(resimAdresi(g))}" alt="">`).join('')}</div>` : ''}</li>`).join('');
}

function yayinOnay() {
  const p = perde(`<h2>Siteye yayınlansın mı?</h2><ul class="ozet">${ozet()}</ul>
    <div class="aciklama-not perde-not2">Hepsi tek seferde gönderilir. Site 1–2 dakika içinde güncellenir.</div>
    <button class="dugme ana tam" id="evet">Yayınla</button><button class="dugme tam ara-bosluk" id="hayir">Henüz değil</button>`);
  $('#hayir', p).onclick = () => p.remove();
  $('#evet', p).onclick = () => { p.remove(); yayinla(); };
}

const BEKLEYEN = 'ipl_bekleyen_yayin';
// Bir commit'in dalda olup olmadığını sorar: true / false.
async function daldaMi(sha) {
  const c = await gh(`/repos/${REPO}/compare/${sha}...${DAL}`);
  return c.status === 'identical' || c.status === 'ahead';
}

async function yayinBasarili(sha) {
  localStorage.removeItem(BEKLEYEN);
  const yerel = { ...D.onizleme };
  await taslakYaz([], { dosyaTemizle: true }).catch(() => bildir('Uyarı: telefondaki taslak temizlenemedi.', 5000));
  D.sonYayin = { sha, zaman: Date.now(), durum: 'hazirlaniyor' };
  localStorage.setItem('ipl_son_yayin', JSON.stringify(D.sonYayin));
  try { D.albumler = albumleriKur((await icerikOku(sha)).dosyalar); } catch (_) { /* liste sonra yenilenir */ }
  D.onizleme = yerel; // site yayına girene kadar yeni fotoğraflar telefondan gösterilir
}

let yayinSuruyor = false;
async function yayinla(onaylananlar = []) {
  if (yayinSuruyor || !D.islemler.length) return;
  yayinSuruyor = true;
  const p = perde(`<h2>Yayınlanıyor…</h2><div class="ilerleme"><i id="yi"></i></div><div class="aciklama-not perde-not" id="ym">Hazırlanıyor</div>`, { kilitli: true });
  const adim = (yuzde, m) => { $('#yi', p).style.width = yuzde + '%'; $('#ym', p).textContent = m; };
  let commitSha = null;
  try {
    for (let deneme = 1; deneme <= 3; deneme++) {
      adim(5, 'Sitenin güncel hali alınıyor');
      const { sha, dosyalar } = await icerikOku();
      const anlik = albumleriKur(dosyalar);

      // Siz düzenlerken aynı sayfa başka yerden değiştiyse önce sorulur.
      const degisen = [...new Set(D.islemler.filter((i) => { const al = anlik.find((a) => a.id === i.album); return al && i.taban && i.taban !== al.oid; }).map((i) => i.album))]
        .filter((id) => !onaylananlar.includes(id));
      if (degisen.length) { p.remove(); yayinSuruyor = false; return cakismaSor(degisen, anlik, onaylananlar); }

      // Tüm değişiklikler uygulanabilmeli; biri bile olmazsa hiçbir şey yayınlanmaz.
      const sorunlu = []; const etkilenen = new Set();
      for (const i of D.islemler) {
        const al = anlik.find((a) => a.id === i.album);
        if (!al) { sorunlu.push({ i, neden: 'Sayfa bulunamadı.' }); continue; }
        try { islemUygula(al, i, true); etkilenen.add(al); } catch (e) { sorunlu.push({ i, neden: e.message }); }
      }
      const yeniler = D.islemler.filter((i) => i.tur === 'ekle');
      const bloblar = [];
      for (const y of yeniler) { const b = await DB.al('dosya', y.gorsel); if (!b) sorunlu.push({ i: y, neden: 'Fotoğraf dosyası telefonda bulunamadı.' }); else bloblar.push([y.gorsel, b]); }
      if (sorunlu.length) { p.remove(); yayinSuruyor = false; return sorunluGoster(sorunlu); }

      const agac = [];
      for (let n = 0; n < bloblar.length; n++) {
        adim(10 + Math.round((n / Math.max(1, bloblar.length)) * 70), `Fotoğraf yükleniyor ${n + 1} / ${bloblar.length}`);
        const b = await gh(`/repos/${REPO}/git/blobs`, 'POST', { content: await blobB64(bloblar[n][1]), encoding: 'base64' });
        agac.push({ path: 'site' + bloblar[n][0], mode: '100644', type: 'blob', sha: b.sha });
      }
      adim(85, 'Sayfalar güncelleniyor');
      for (const al of etkilenen) {
        const yeni = JSON.stringify(al.veri, null, 2) + '\n';
        if (yeni.trim() !== (dosyalar[al.yol]?.text || '').trim()) agac.push({ path: al.yol, mode: '100644', type: 'blob', content: yeni });
      }
      if (!agac.length) { await taslakYaz([], { dosyaTemizle: true }).catch(() => {}); p.remove(); bildir('Yayınlanacak değişiklik kalmadı.'); return ciz(); }
      const temel = await gh(`/repos/${REPO}/git/commits/${sha}`);
      const tree = await gh(`/repos/${REPO}/git/trees`, 'POST', { base_tree: temel.tree.sha, tree: agac });
      const c = await gh(`/repos/${REPO}/git/commits`, 'POST', { message: `Yönetim uygulaması: ${D.islemler.length} değişiklik`, tree: tree.sha, parents: [sha] });
      commitSha = c.sha;
      localStorage.setItem(BEKLEYEN, JSON.stringify({ sha: c.sha, zaman: Date.now() }));
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
      await yayinBasarili(c.sha);
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
  const ad = (i) => D.albumler.find((a) => a.id === i.album)?.ad || i.album;
  const p = perde(`<h2>Yayın durduruldu</h2>
    <div class="aciklama-not perde-not2">Aşağıdaki ${sorunlu.length} değişiklik uygulanamadığı için sitede hiçbir şey değiştirilmedi.</div>
    <ul class="ozet">${sorunlu.map((s) => `<li><b>${kacir(ad(s.i))}</b>: ${kacir(s.neden)}</li>`).join('')}</ul>
    <button class="dugme ana tam ara-bosluk" id="cikar">Bunları çıkar, kalanları yayınla</button>
    <button class="dugme tam ara-bosluk" id="kapat">Kapat</button>`);
  $('#kapat', p).onclick = () => p.remove();
  $('#cikar', p).onclick = async () => {
    const at = new Set(sorunlu.map((s) => s.i));
    try { await taslakYaz(D.islemler.filter((i) => !at.has(i)), { dosyaSil: sorunlu.filter((s) => s.i.tur === 'ekle').map((s) => s.i.gorsel) }); }
    catch (e) { p.remove(); return hataPenceresi('Kaydedilemedi', e.message); }
    p.remove(); ciz(); if (D.islemler.length) yayinOnay();
  };
}

// Sonucu belirsiz kalmış bir yayın varsa (bağlantı kopmuştu) önce onu netleştirir.
async function bekleyenYayiniDogrula() {
  let b = null; try { b = JSON.parse(localStorage.getItem(BEKLEYEN) || 'null'); } catch (_) {}
  if (!b) return;
  try {
    if (await daldaMi(b.sha)) { await yayinBasarili(b.sha); bildir('Önceki yayınınız başarıyla kaydedilmiş ✓', 4000); yayinIzle(); }
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
    if (y.durum === 'yayinda') bildir('Siteniz güncellendi ✓', 4000);
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
    for (const i of D.islemler) if (i.tur === 'ekle') { const b = await DB.al('dosya', i.gorsel); if (b) D.onizleme[i.gorsel] = URL.createObjectURL(b); }
  } catch (_) { D.kayitHatasi = true; }
  try { D.sonYayin = JSON.parse(localStorage.getItem('ipl_son_yayin') || 'null'); } catch (_) {}
  if (D.sonYayin && D.sonYayin.durum !== 'hazirlaniyor') D.sonYayin = null;
  history.replaceState({ ad: 'ana' }, '');
  yukleniyorEkrani();
  try {
    await gh('/user'); D.giris = true;
    await bekleyenYayiniDogrula();
    const { dosyalar } = await icerikOku();
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
