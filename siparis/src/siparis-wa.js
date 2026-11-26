/* Sipariş talebi: seçimler, ön fiyat ve telefon sunucuya kaydedilir (info@ adresine mail), dosya Google Drive'a yüklenir;
   WhatsApp isteğe bağlı ikinci kanaldır.
   Kesin fiyat ve üretim onayı dosya kontrolünden sonra IPL tarafından verilir; ödeme onaydan sonra alınır. */
(function () {
  // Hesaplayıcı hazır: içerik JS ile dolduktan sonra görünür olur (yüklenirken sayfa zıplamasın — CLS)
  document.documentElement.classList.add('hazir');
  var NUMARA = '905325237364';
  var btn = document.getElementById('devam'), form = document.getElementById('f');
  if (!btn || !form) return;
  btn.textContent = 'Sipariş talebini gönder';

  var not = document.createElement('div');
  not.className = 'msg warn';
  not.style.margin = '12px 0';
  not.textContent = 'Gösterilen tutar ön hesaplamadır. Kesin fiyat ve üretim uygunluğu dosyanız incelendikten sonra onaylanır; ödeme onayımızdan sonra alınır.';
  btn.parentNode.insertBefore(not, btn);

  // Talep alanı: tek zorunlu bilgi telefon. Daha önce bu tarayıcıdan talep gönderildiyse numara ve ad hazır gelir.
  var hafiza = {}; try { hafiza = JSON.parse(localStorage.getItem('ipl_talep_kisi') || '{}') || {}; } catch (x) {}
  var alan = document.createElement('div');
  alan.id = 'talepAlan';
  alan.innerHTML = '<label class="f" style="margin-top:4px">Telefonunuz<input type="tel" id="tTel" name="tel" autocomplete="tel" inputmode="tel" placeholder="05xx xxx xx xx" maxlength="25"></label>'
    + '<label class="f" style="margin-top:10px">Adınız <span class="small" style="margin:0">(isteğe bağlı)</span><input type="text" id="tAd" name="name" autocomplete="name" maxlength="80"></label>'
    + '<label aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">Boş bırakın<input type="text" id="tWeb" tabindex="-1" autocomplete="off"></label>'
    + '<p class="small" style="margin-top:8px">Numaranız yalnızca siparişinizle ilgili size dönmek için kullanılır (<a href="/kvkk/" target="_blank" rel="noopener">KVKK</a>).</p>'
    + '<div id="tHata" class="msg bad" style="display:none" role="alert"></div>';
  btn.parentNode.insertBefore(alan, btn);
  var tTel = document.getElementById('tTel'), tAd = document.getElementById('tAd'), tHata = document.getElementById('tHata');
  if (hafiza.tel) tTel.value = hafiza.tel;
  if (hafiza.ad) tAd.value = hafiza.ad;
  function hata(m) { tHata.textContent = m; tHata.style.display = m ? '' : 'none'; }
  tTel.addEventListener('input', function () { tTel.removeAttribute('aria-invalid'); hata(''); });

  function temiz(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function gorunur(el) { return !!(el.offsetParent || el.getClientRects().length); }
  function etiketMetni(lab) {
    if (!lab) return '';
    var k = lab.cloneNode(true);
    k.querySelectorAll('input,select,textarea,small').forEach(function (x) { x.remove(); });
    return temiz(k.textContent);
  }
  function grupBasligi(el) {
    var sec = el.closest('section.step'), c = el.closest('label') || el;
    for (var p = c; p && p !== sec; p = p.parentElement) {
      for (var o = p.previousElementSibling; o; o = o.previousElementSibling) {
        if (o.matches('p.hint')) return temiz(o.textContent).replace(/:$/, '');
        if (o.matches('h2')) break;
      }
    }
    var h = sec && sec.querySelector('h2');
    if (!h) return '';
    var k = h.cloneNode(true); k.querySelectorAll('.n').forEach(function (x) { x.remove(); });
    return temiz(k.textContent);
  }
  function secimler() {
    var satir = [], dosyalar = [];
    form.querySelectorAll('input,select,textarea').forEach(function (el) {
      if (el.id === 'onay' || el.type === 'hidden' || el.type === 'color' || el.type === 'date' || el.type === 'time') return; // tarih ve saat özette okunur biçimde yer alır
      var sec = el.closest('section.step');
      if (sec && !gorunur(sec)) return;
      var gizliKap = el.closest('[style*="display: none"],[style*="display:none"]');
      if (gizliKap && gizliKap !== el) return;
      if (el.type === 'file') { if (el.files && el.files[0]) dosyalar.push(el.files[0].name); return; }
      if (el.type === 'radio') {
        if (!el.checked) return;
        var lab = el.closest('label'), deger = '';
        if (lab) { var b = lab.querySelector('b'), sm = lab.querySelector('small');
          // yazı tipi seçeneklerinde kalın metin örnek yazıdır; yazı tipinin adı alttaki küçük satırdadır
          if (b && b.style.fontFamily && sm) deger = temiz(sm.textContent); else deger = temiz(b ? b.textContent : (sm ? sm.textContent : '')) || temiz(lab.getAttribute('title')); }
        if (el.value === 'ozel') { var oz = document.getElementById('renkOzel'); if (oz) deger = 'Özel renk ' + oz.value.toUpperCase(); }
        if (deger) satir.push(grupBasligi(el) + ': ' + deger);
        return;
      }
      if (el.type === 'checkbox') { if (el.checked) satir.push(etiketMetni(el.closest('label')) || el.id); return; }
      var v = el.tagName === 'SELECT' ? temiz(el.options[el.selectedIndex] && el.options[el.selectedIndex].text) : temiz(el.value);
      if (!v) return;
      var ad = etiketMetni(el.closest('label')) || temiz(el.getAttribute('placeholder')) || el.id;
      satir.push(ad + ': ' + v);
    });
    document.querySelectorAll('.filecard b').forEach(function (b) { var n = temiz(b.textContent); if (n && dosyalar.indexOf(n) < 0) dosyalar.push(n); });
    return { satir: satir, dosyalar: dosyalar };
  }
  function fiyatSatirlari() {
    var out = [];
    document.querySelectorAll('#ozetIc .line').forEach(function (l) {
      var s = l.querySelectorAll('span');
      if (s.length >= 2) out.push(temiz(s[0].textContent) + ': ' + temiz(s[1].textContent));
    });
    return out;
  }
  // o.no: talep numarası (WhatsApp mesajında), o.sunucu: bize giden kayıt/mail metni (selamlama ve "ekliyorum" satırları olmadan)
  function mesaj(o) {
    o = o || {};
    var urun = temiz((document.querySelector('h1') || {}).textContent);
    var s = secimler(), f = fiyatSatirlari(), pdf = document.getElementById('pdfIndir');
    var m = o.sunucu ? [] : [o.no ? 'Merhaba, istanbulprintlab.com üzerinden ' + o.no + ' numaralı sipariş talebimi gönderdim.' : 'Merhaba, istanbulprintlab.com üzerinden sipariş talebi göndermek istiyorum.', '', 'Ürün: ' + urun];
    if (s.satir.length) m.push(m.length ? '' : null, 'Seçimler:', s.satir.map(function (x) { return '• ' + x; }).join('\n'));
    f = f.filter(function (x) { return s.satir.indexOf(x) < 0; });
    if (f.length) m.push('', 'Ön hesaplama:', f.map(function (x) { return '• ' + x; }).join('\n'));
    if (pdf && gorunur(pdf)) m.push('', o.sunucu ? 'Baskı dosyası: sitede tasarlandı (PDF siteden yüklenir).' : 'Baskı dosyam sitede tasarladığım PDF.');
    else if (s.dosyalar.length) m.push('', 'Baskı dosyası: ' + s.dosyalar.join(', '));
    if (document.querySelector('#dosyaSonuc .msg.warn')) m.push('', 'Dosya ön kontrolünde uyarı çıktı; dosyanın kontrol edilmesi gerekiyor.');
    if (!o.sunucu) m.push('', 'Seçimlerimi ve yazımları kontrol edip onayladım.');
    return m.filter(function (x) { return x !== null; }).join('\n');
  }
  // Hesaplayıcı adımları (PostHog): fiyat görüldü, dosya yüklendi, sipariş talebi gönderildi — her biri sayfa başına bir kez
  var olaylar = {};
  function olay(ad, ek) {
    if (olaylar[ad]) return; olaylar[ad] = 1;
    try { if (window.__phOlay) window.__phOlay(ad, Object.assign({ urun: location.pathname }, ek || {})); } catch (x) {}
  }
  var mTop = document.getElementById('mTop');
  var izle = function () {
    if (mTop && /\d/.test(mTop.textContent)) olay('hesaplayici_fiyat', { tutar: temiz(mTop.textContent) });
    if (document.querySelector('.filecard')) olay('hesaplayici_dosya');
    // fiyat "teklif" durumuna düşüp sipariş düğmesi gizlenince telefon alanı da gizlensin
    if (typeof alan !== 'undefined' && !document.getElementById('talepSonuc')) { var g = btn.style.display === 'none' ? 'none' : ''; if (alan.style.display !== g) alan.style.display = g; }
    // baskıya hazır işte düğme "öde" adımını haber verir (gönderdikten sonra kartla ödeme açılır)
    if (!gonderiliyor && !document.getElementById('talepSonuc')) { var y = (window.IPLSiparis || {}).odenebilir ? 'Siparişi tamamla ve öde' : 'Sipariş talebini gönder'; if (btn.textContent !== y) btn.textContent = y; }
  };
  if (window.MutationObserver) new MutationObserver(izle).observe(document.body, { childList: true, subtree: true, characterData: true });
  // ── Sipariş talebi akışı ──────────────────────────────────────────────────────────────
  // 1) Talep (seçimler + ön fiyat + telefon) hemen sunucuya kaydedilir ve info@ adresine mail gider.
  // 2) Dosya varsa tarayıcıdan doğrudan Google Drive'a, parça parça yüklenir (kopma olursa kaldığı yerden devam eder).
  // 3) WhatsApp isteğe bağlıdır; müşteri açmasa da talep bizde kalır.
  var AZAMI = 300 * 1048576, PARCA = 8 * 1048576; // Drive parça boyu 256 KB'ın katı olmalı
  var sonDosya = {}; // input id → seçilen dosya (sürükle-bırakla gelenler input.files'a düşmez)
  form.querySelectorAll('input[type=file]').forEach(function (inp) {
    if (inp.id === 'logo') return; // kartvizit logosu baskı dosyası değil; tasarlanan PDF'in içine gömülür
    inp.addEventListener('change', function () { if (inp.files && inp.files[0]) sonDosya[inp.id] = inp.files[0]; });
    var kutu = inp.closest('label');
    if (kutu) kutu.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) sonDosya[inp.id] = f; }, true);
  });
  function seciliDosya() {
    var pdf = document.getElementById('pdfIndir');
    if (pdf && gorunur(pdf) && typeof window.IPLPdfUret === 'function') // sitede tasarlanan kartvizit / davetiye
      return window.IPLPdfUret().then(function (b) { return b ? { blob: b, ad: (temiz((document.querySelector('h1') || {}).textContent) || 'baski').toLocaleLowerCase('tr-TR').replace(/[^a-z0-9ğüşıöç]+/g, '-').replace(/^-|-$/g, '') + '.pdf', tur: 'application/pdf' } : null; });
    var bulunan = null;
    form.querySelectorAll('input[type=file]').forEach(function (inp) {
      if (bulunan || inp.id === 'logo' || !sonDosya[inp.id]) return;
      var sec = inp.closest('section.step'); if (sec && !gorunur(sec)) return;
      var gizliKap = inp.closest('[style*="display: none"],[style*="display:none"]'); if (gizliKap) return;
      var f = sonDosya[inp.id]; bulunan = { blob: f, ad: f.name, tur: f.type || 'application/octet-stream' };
    });
    return Promise.resolve(bulunan);
  }
  function rastgele() {
    var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function postJSON(yol, veri) {
    return fetch('/.netlify/functions/' + yol, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(veri) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.__durum = r.status; return j; }); });
  }
  function waLink(no) { return 'https://wa.me/' + NUMARA + '?text=' + encodeURIComponent(mesaj({ no: no })); }

  var istemci = null, gonderiliyor = false, yukleniyor = false;
  window.addEventListener('beforeunload', function (e) { if (yukleniyor) { e.preventDefault(); e.returnValue = ''; } });

  // Sonuç kutusu: talep numarası, dosya yükleme ilerlemesi, isteğe bağlı WhatsApp
  function sonucKutusu(no, dosyaVar) {
    alan.style.display = 'none'; btn.style.display = 'none'; not.style.display = 'none';
    var dn = document.getElementById('devamNot'); if (dn) dn.style.display = 'none';
    var k = document.createElement('div');
    k.id = 'talepSonuc';
    k.innerHTML = '<div class="msg ok" style="margin-top:14px"><b style="font-weight:600">Talebiniz alındı.</b><br>Talep numaranız: <b style="font-weight:600" id="tNo"></b><br>Talebinizi inceleyip size telefonla dönüş yapacağız.</div>'
      + (dosyaVar ? '<div id="tYukle" style="margin-top:12px"><div class="small" style="margin:0 0 6px" id="tYukleMetin">Dosyanız yükleniyor… Lütfen bu sayfayı kapatmayın.</div><div style="height:8px;border-radius:99px;background:var(--line);overflow:hidden"><div id="tBar" style="height:100%;width:0;background:var(--ink);transition:width .2s"></div></div></div>' : '')
      + '<a class="btn ghost" id="tWa" target="_blank" rel="noopener">WhatsApp\'tan da yazabilirsiniz</a>';
    btn.parentNode.insertBefore(k, btn);
    document.getElementById('tNo').textContent = no;
    document.getElementById('tWa').href = waLink(no);
  }
  // Baskıya hazır siparişte müşteri beklemeden öder: sunucu tutarı yeniden hesaplar, ödeme sayfasına yönlendirir.
  function odemeDugmesi(t, otomatik) {
    var kutu = document.getElementById('talepSonuc'); if (!kutu || document.getElementById('tOde')) return;
    var m = kutu.querySelector('.msg.ok');
    if (m) m.innerHTML = '<b style="font-weight:600">Siparişiniz hazır, ödeme sayfasına geçiliyor.</b><br>Sipariş numaranız: <b style="font-weight:600">' + t.no + '</b><br>Kartla, dilerseniz taksitle ödeyebilirsiniz. Dosyanız üretimden önce son teknik kontrolden geçer; baskıya engel bir durum olursa sizinle iletişime geçeriz.';
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = 'tOde'; b.style.marginTop = '12px'; b.style.width = '100%';
    b.textContent = 'Kartla öde' + (mTop && /\d/.test(mTop.textContent) ? ' · ' + temiz(mTop.textContent) : '');
    var e = document.createElement('div'); e.className = 'small'; e.id = 'tOdeNot'; e.style.margin = '6px 0 0';
    kutu.insertBefore(b, document.getElementById('tWa')); kutu.insertBefore(e, document.getElementById('tWa'));
    b.addEventListener('click', function () {
      b.disabled = true; b.textContent = 'Ödeme sayfası açılıyor…'; e.textContent = ''; e.style.color = '';
      olay('odeme_tiklandi', { talep: t.no });
      postJSON('talep-odeme', { no: t.no, anahtar: t.anahtar }).then(function (j) {
        if (j.link) { try { window.top.location.href = j.link; } catch (x) { location.href = j.link; } return; }
        b.disabled = !!j.odendi; b.textContent = j.odendi ? 'Ödeme alındı' : 'Kartla öde';
        e.textContent = j.message || 'Ödeme sayfası açılamadı. Lütfen tekrar deneyin ya da WhatsApp\'tan yazın.'; e.style.color = 'var(--bad)';
      }, function () { b.disabled = false; b.textContent = 'Kartla öde'; e.textContent = 'Bağlantı hatası, lütfen tekrar deneyin.'; e.style.color = 'var(--bad)'; });
    });
    if (otomatik) b.click(); // ekstra tıklama olmadan ödeme sayfasına geçilir; açılamazsa düğme yedek olarak kalır
  }
  function yuklemeDurumu(oran, metin, tur) {
    var b = document.getElementById('tBar'), m = document.getElementById('tYukleMetin');
    if (b && oran != null) b.style.width = Math.round(oran * 100) + '%';
    if (m && metin) { m.textContent = metin; m.style.color = tur === 'bad' ? 'var(--bad)' : tur === 'ok' ? 'var(--ok)' : ''; }
  }

  // Drive'a kesintiden devam edebilen yükleme. 308 = parça alındı; 200/201 = dosya tamam.
  // Drive'ın aldığı bayt konumu (Range) tarayıcıda okunamazsa ya da bağlantı koparsa konum sunucuya sorulur (sunucuda CORS kısıtı yok).
  function parcaGonder(adres, blob, bas, toplam) {
    return new Promise(function (coz) {
      var son = Math.min(bas + PARCA, toplam), x = new XMLHttpRequest();
      x.open('PUT', adres, true);
      x.timeout = 180000; // 8 MB parça çok yavaş hatta bile 3 dakikada gitmeli; takılırsa durum sorulur
      x.setRequestHeader('Content-Range', 'bytes ' + bas + '-' + (son - 1) + '/' + toplam);
      x.upload.onprogress = function (e) { if (e.lengthComputable) yuklemeDurumu((bas + e.loaded) / toplam, 'Dosyanız yükleniyor… %' + Math.floor((bas + e.loaded) / toplam * 100) + ' — lütfen bu sayfayı kapatmayın.'); };
      x.onload = function () {
        if (x.status === 200 || x.status === 201) { var j = {}; try { j = JSON.parse(x.responseText); } catch (_) {} return coz({ bitti: true, id: j.id || null }); }
        if (x.status === 308) { var r = null; try { r = x.getResponseHeader('Range'); } catch (_) {} var m = r && /bytes=0-(\d+)/.exec(r); return coz(m ? { sonraki: parseInt(m[1], 10) + 1 } : { sor: true }); }
        coz({ sor: true, hata: 'HTTP ' + x.status });
      };
      x.onerror = function () { coz({ sor: true, hata: 'ağ' }); };
      x.ontimeout = function () { coz({ sor: true, hata: 'zaman aşımı' }); };
      x.send(blob.slice(bas, son));
    });
  }
  function bekle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // Dönüş: Promise<{ tamam: true }> ya da hata (reject)
  function yukle(t, adres, blob) {
    var toplam = blob.size, bas = 0, deneme = 0;
    function sunucuyaSor() { return postJSON('talep-dosya', { no: t.no, anahtar: t.anahtar, durum: 1 }); }
    function adim() {
      return parcaGonder(adres, blob, bas, toplam).then(function (s) {
        if (s.bitti && s.id) return postJSON('talep-dosya', { no: t.no, anahtar: t.anahtar, id: s.id }).then(function (j) {
          if (j.tamam) return { tamam: true };
          if (j.__durum >= 500 || !j.__durum) return sor(); // geçici sunucu hatası: durumu yeniden sor
          throw new Error('Dosya doğrulanamadı');
        });
        if (s.sonraki != null) { if (s.sonraki > bas) deneme = 0; bas = s.sonraki; return adim(); }
        return sor(s.bitti ? null : s.hata);
      });
    }
    function sor(hataVar) {
      if (hataVar && ++deneme > 8) return Promise.reject(new Error(hataVar));
      if (hataVar) yuklemeDurumu(null, 'Bağlantı yavaş, yükleme sürüyor… lütfen bu sayfayı kapatmayın.');
      return bekle(hataVar ? Math.min(15000, 1000 * Math.pow(2, deneme)) : 0).then(sunucuyaSor).then(function (j) {
        if (j.bitti) return { tamam: true };
        if (j.yeni) { adres = j.yeni; bas = 0; return adim(); }
        if (j.sonraki != null) { if (j.sonraki > bas) deneme = 0; bas = j.sonraki; return adim(); }
        if (j.__durum === 409) throw new Error('Dosya doğrulanamadı');
        if (++deneme > 8) throw new Error(j.message || 'durum alınamadı');
        return bekle(Math.min(15000, 1000 * Math.pow(2, deneme))).then(function () { return sor(); });
      }, function () { if (++deneme > 8) throw new Error('ağ'); return bekle(Math.min(15000, 1000 * Math.pow(2, deneme))).then(function () { return sor(); }); });
    }
    return adim();
  }

  btn.addEventListener('click', function () {
    if (btn.disabled || gonderiliyor) return;
    var tel = tTel.value.trim(), rakam = tel.replace(/\D/g, '');
    if (rakam.length < 10) { tTel.setAttribute('aria-invalid', 'true'); hata('Size ulaşabilmemiz için telefon numaranızı yazın.'); tTel.focus(); return; }
    hata(''); gonderiliyor = true; btn.disabled = true; btn.textContent = 'Gönderiliyor…';
    olay('hesaplayici_siparis', { tutar: mTop ? temiz(mTop.textContent) : '' });
    try { localStorage.setItem('ipl_talep_kisi', JSON.stringify({ tel: tel, ad: tAd.value.trim() })); } catch (x) {}
    istemci = istemci || rastgele();
    // Doğrudan ödeme: hesaplayıcı bu an "baskıya hazır" diyorsa (fiyat tamam, dosya ön kontrolden geçti) kartla ödeme düğmesi açılır
    var sip = window.IPLSiparis || {}, odenebilir = !!sip.odenebilir;
    seciliDosya().then(function (d) {
      var buyuk = d && d.blob.size > AZAMI;
      var veri = { istemci: istemci, telefon: tel, ad: tAd.value.trim(), web: document.getElementById('tWeb').value, urunAd: temiz((document.querySelector('h1') || {}).textContent),
        ozet: mesaj({ sunucu: true }), toplam: mTop ? temiz(mTop.textContent) : '', sayfa: location.href,
        not: buyuk ? 'Dosya 300 MB\'tan büyük (' + d.ad + ', ' + Math.round(d.blob.size / 1048576) + ' MB); WhatsApp/WeTransfer ile gönderecek.' : '',
        dosya: d && !buyuk ? { ad: d.ad, boyut: d.blob.size, tur: d.tur } : null,
        urunKod: sip.kod, girdi: sip.girdi, odenebilir: odenebilir };
      return postJSON('talep', veri).then(function (j) {
        if (!j.no) {
          gonderiliyor = false; btn.disabled = false; btn.textContent = 'Sipariş talebini gönder';
          if (j.__durum === 400 && j.alan === 'telefon') { tTel.setAttribute('aria-invalid', 'true'); tTel.focus(); }
          hata((j.message || 'Talebiniz gönderilemedi.') + (j.__durum >= 500 || !j.__durum ? ' Lütfen tekrar deneyin ya da WhatsApp\'tan yazın.' : ''));
          return;
        }
        istemci = null; // sonraki (yeni) talep yeni kayıt açsın
        olay('talep_kaydedildi', { talep: j.no, dosya: d ? (buyuk ? 'buyuk' : 'var') : 'yok' });
        try { if (window.parent !== window) window.parent.postMessage({ ipl: 'olay', ad: 'talep_gonderildi', urun: location.pathname }, location.origin); } catch (x) {}
        sonucKutusu(j.no, !!(d && !buyuk));
        if (odenebilir && !buyuk) { var ok = document.querySelector('#talepSonuc .msg.ok'); if (ok) ok.innerHTML = '<b style="font-weight:600">Siparişiniz alındı.</b><br>Sipariş numaranız: <b style="font-weight:600">' + j.no + '</b><br>' + (d ? 'Dosyanız yüklendikten sonra ödeme sayfasına geçeceksiniz.' : 'Ödeme sayfasına geçiliyor…'); }
        if (buyuk) { var m = document.createElement('div'); m.className = 'msg warn'; m.textContent = 'Dosyanız 300 MB\'tan büyük olduğu için siteden yüklenemedi. Lütfen dosyanızı WhatsApp\'tan ya da WeTransfer ile gönderin; talebiniz bize ulaştı.'; document.getElementById('talepSonuc').insertBefore(m, document.getElementById('tWa')); return; }
        if (!d) { if (odenebilir) odemeDugmesi(j, true); return; }
        // Drive o an yanıt vermediyse aynı talep için iki kez daha yükleme adresi istenir (yeni talep açılmaz)
        var adresIste = function (n) {
          if (j.yukleme || n >= 2) return Promise.resolve(j.yukleme);
          yuklemeDurumu(0, 'Dosya yüklemesi hazırlanıyor…');
          return bekle(2500).then(function () { return postJSON('talep', veri); }).then(function (y) { if (y.yukleme) j.yukleme = y.yukleme; return adresIste(n + 1); }, function () { return adresIste(n + 1); });
        };
        return adresIste(0).then(function (adres) {
        if (!adres) { yuklemeDurumu(0, 'Dosyanız şu an siteden alınamadı. Talebiniz bize ulaştı; lütfen dosyanızı aşağıdaki WhatsApp düğmesinden gönderin.', 'bad'); return; }
        yukleniyor = true;
        return yukle(j, adres, d.blob).then(function () {
          yukleniyor = false; yuklemeDurumu(1, 'Dosyanız da alındı. Teşekkür ederiz.', 'ok');
          var bar = document.getElementById('tBar'); if (bar) bar.parentNode.style.display = 'none';
          olay('dosya_yuklendi', { talep: j.no });
          if (odenebilir) odemeDugmesi(j, true);
        }, function (e) {
          yukleniyor = false; yuklemeDurumu(null, 'Dosyanız yüklenemedi. Talebiniz bize ulaştı; dosyanızı aşağıdaki WhatsApp düğmesinden gönderebilirsiniz.', 'bad');
          olay('dosya_yuklenemedi', { talep: j.no });
          return postJSON('talep-dosya', { no: j.no, anahtar: j.anahtar, hata: String(e && e.message || 'hata') }).then(function (r) {
            if (r.tamam) yuklemeDurumu(1, 'Dosyanız da alındı. Teşekkür ederiz.', 'ok'); // Drive'a aslında ulaşmışsa
          }, function () {});
        });
        });
      });
    }).catch(function () {
      gonderiliyor = false; btn.disabled = false; btn.textContent = 'Sipariş talebini gönder';
      hata('Bağlantı hatası, talebiniz gönderilemedi. Lütfen tekrar deneyin.');
    });
  });
  // Gömülü hesaplayıcıda WhatsApp/telefon/e-posta tıklamalarını üst sayfaya bildir; üst sayfa Google etiketiyle dönüşüm olarak gönderir
  if (window.parent !== window && document.documentElement.classList.contains('gomulu')) {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null; if (!a) return;
      var h = a.getAttribute('href') || '';
      var ad = /wa\.me|whatsapp/i.test(h) ? 'whatsapp_click' : (/^tel:/i.test(h) ? 'phone_click' : (/^mailto:/i.test(h) ? 'email_click' : null));
      if (ad) try { window.parent.postMessage({ ipl: 'olay', ad: ad, urun: location.pathname }, location.origin); } catch (x) {}
    }, true);
  }
  window.IPLSiparisMesaji = mesaj; // test için

  // Sitenin ürün sayfasına gömülüyken yüksekliği üst sayfaya bildir (çerçeve kaydırma çubuğu olmadan uzar)
  if (document.documentElement.classList.contains('gomulu') && window.parent !== window) {
    var son = 0;
    var bildir = function () { var h = Math.ceil(document.body.getBoundingClientRect().height) + 4; if (Math.abs(h - son) > 2) { son = h; window.parent.postMessage({ ipl: 'yukseklik', h: h, yol: location.pathname }, location.origin); } };
    if (window.ResizeObserver) new ResizeObserver(bildir).observe(document.body);
    window.addEventListener('load', bildir); setInterval(bildir, 1500); bildir();
    // Üst sayfa kaydırıldıkça sipariş özeti görünür alanda kalır (masaüstünde iki sütunlu düzende)
    var ozet = document.getElementById('ozet'), duzen = ozet && ozet.parentElement;
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data || e.data.ipl !== 'konum' || !ozet) return;
      var ikiSutun = ozet.getBoundingClientRect().left > form.getBoundingClientRect().left + 40;
      if (!ikiSutun) { ozet.style.transform = ''; return; }
      ozet.style.transform = '';
      var ust = ozet.getBoundingClientRect().top + window.scrollY, alt = duzen.getBoundingClientRect().bottom + window.scrollY;
      var kayma = Math.max(0, Math.min(-e.data.top + (e.data.ust || 0) + 16 - ust, alt - ust - ozet.offsetHeight));
      ozet.style.transform = kayma ? 'translateY(' + Math.round(kayma) + 'px)' : '';
    });
  }
})();
