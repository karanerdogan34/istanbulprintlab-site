/* Yönetim: ödeme kayıtları listesi. Metinler textContent ile yazılır (müşteri girdisi HTML olarak işlenmez). */
(function () {
  var V = [], K = null, liste = document.getElementById('liste'), m = document.getElementById('mesaj');
  var tl = function (k) { return (k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL'; };
  var DURUM = { basarili: 'ÖDENDİ', mukerrer: 'MÜKERRER ÖDEME — iade gerekebilir', inceleme: 'ÖDEME ALINDI — İNCELEYİN', basarisiz: 'Başarısız', baslatildi: 'Ödeme sayfası açıldı (sonuç yok)' };
  function el(etiket, metin, stil) { var e = document.createElement(etiket); if (metin != null) e.textContent = metin; if (stil) e.style.cssText = stil; return e; }
  function ciz() {
    var sadece = document.getElementById('sadeceOdenen').checked, testGizle = document.getElementById('testGizle').checked;
    var L = V.filter(function (d) { return (!sadece || d.durum === 'basarili' || d.durum === 'mukerrer' || d.durum === 'inceleme') && (!testGizle || !d.test); });
    liste.textContent = '';
    m.textContent = L.length ? L.length + ' kayıt' : 'Kayıt yok.';
    // Sistem uyarısı: ödeme bildirim aktarıcısı / zamanlanmış kontrol
    var uy = [], simdi = Date.now();
    if (!K || !K.zaman) uy.push('Otomatik ödeme kontrolü henüz çalışmadı.');
    else {
      if (simdi - Date.parse(K.zaman) > 15 * 60e3) uy.push('Otomatik ödeme kontrolü ' + Math.round((simdi - Date.parse(K.zaman)) / 60e3) + ' dakikadır çalışmadı.');
      var ak = K.aktarici || {};
      if (ak.hata) uy.push('Bildirim aktarıcısına ulaşılamıyor (' + ak.hata + '). Son başarılı kontrol: ' + (K.sonBasarili ? new Date(K.sonBasarili).toLocaleString('tr-TR') : '-'));
      if (ak.bekleyen && ak.enEski && simdi - ak.enEski > 15 * 60e3) uy.push('Aktarıcıda 15 dakikadan uzun süredir siteye işlenemeyen ' + ak.bekleyen + ' bildirim var.');
      if (ak.karantina) uy.push(ak.karantina + ' bildirim karantinada (site reddetti). PayTR panelinden kontrol edin; geçici bir hataysa aşağıdaki "Karantinadakileri yeniden dene" düğmesini kullanın.');
      if (K.sorgu && K.sorgu.bildirilmedi) uy.push('PayTR\'ın başarılı gördüğü ama siteye ulaşmayan ' + K.sorgu.bildirilmedi + ' ödeme var — aşağıdaki kayıtlara bakın.');
    }
    uy.forEach(function (t) { liste.appendChild(el('div', 'UYARI: ' + t, 'border:1px solid #c62828;color:#c62828;border-radius:10px;padding:10px 12px;margin:0 0 10px;font-size:13px;font-weight:600;background:#fff5f5')); });
    L.forEach(function (d) {
      var k = el('div', null, 'border:1px solid #e4e4e0;border-radius:12px;padding:12px 14px;margin:0 0 10px;background:#fff');
      var ok = d.durum === 'basarili', uyari = d.durum === 'mukerrer' || d.durum === 'inceleme';
      k.appendChild(el('div', (DURUM[d.durum] || d.durum) + (d.test ? ' · TEST' : ''), 'font-weight:700;font-size:13px;color:' + (uyari ? '#c62828' : ok ? '#1b7f3b' : '#777')));
      k.appendChild(el('div', d.siparisNo + ' — ' + d.aciklama, 'font-weight:600;margin-top:4px'));
      k.appendChild(el('div', 'Sipariş tutarı: ' + tl(d.kurus) + (d.sonuc && d.sonuc.toplam ? ' · Müşterinin ödediği: ' + tl(d.sonuc.toplam) + ' · ' + (d.sonuc.taksit || '1') + ' taksit' : ''), 'font-size:14px;margin-top:2px'));
      k.appendChild(el('div', new Date(d.zaman).toLocaleString('tr-TR') + ' · PayTR no: ' + d.oid, 'font-size:12px;color:#777;margin-top:2px'));
      var mu = d.musteri || {}, f = d.fatura || {};
      k.appendChild(el('div', mu.ad + ' · ' + mu.telefon + ' · ' + mu.eposta, 'font-size:14px;margin-top:8px'));
      k.appendChild(el('div', 'Adres: ' + mu.adres, 'font-size:14px'));
      k.appendChild(el('div', f.tur === 'kurumsal' ? 'Kurumsal fatura: ' + f.unvan + ' · ' + f.vergiDairesi + ' VD · VKN ' + f.vkn : 'Bireysel fatura' + (f.tckn ? ' · TCKN ' + f.tckn : ''), 'font-size:14px;font-weight:600'));
      if (d.sonuc && d.sonuc.not) k.appendChild(el('div', 'DİKKAT: ' + d.sonuc.not + ' — PayTR panelinden kontrol edin.', 'font-size:13px;color:#c62828'));
      else if (d.sonuc && d.sonuc.tutarUyumlu === false) k.appendChild(el('div', 'DİKKAT: Ödenen tutar sipariş tutarından düşük görünüyor — PayTR panelinden kontrol edin.', 'font-size:13px;color:#c62828'));
      if (d.sorguUyari) k.appendChild(el('div', 'DİKKAT: ' + d.sorguUyari, 'font-size:13px;color:#c62828'));
      if (d.sonuc && d.sonuc.kaynak === 'durum-sorgu') k.appendChild(el('div', 'Not: Bu sonuç PayTR bildirimi yerine durum sorgusuyla alındı.', 'font-size:12px;color:#777'));
      if (d.durum === 'basarisiz' && d.sonuc) k.appendChild(el('div', 'Sebep: ' + (d.sonuc.mesaj || d.sonuc.kod || '-'), 'font-size:13px;color:#777'));
      liste.appendChild(k);
    });
  }
  fetch('/.netlify/functions/odeme-liste', { method: 'POST', credentials: 'same-origin', headers: { 'x-yonetim': '1' } })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (s) { if (!s.ok) throw new Error(s.j.message || 'Liste alınamadı.'); V = s.j.odemeler || []; K = s.j.kontrol || null; ciz(); })
    .catch(function (e) { m.textContent = e.message; });
  var kb = document.getElementById('karantinaDene');
  if (kb) kb.onclick = function () {
    kb.disabled = true; m.textContent = 'Karantinadaki bildirimler yeniden deneniyor…';
    fetch('/.netlify/functions/odeme-karantina', { method: 'POST', credentials: 'same-origin', headers: { 'x-yonetim': '1' } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (s) { if (!s.ok) throw new Error(s.j.message || 'İşlem yapılamadı.'); m.textContent = 'Karantina: ' + s.j.toplam + ' kayıt, ' + s.j.kurtarilan + ' kurtarıldı, ' + s.j.reddedilen + ' hâlâ reddediliyor.'; })
      .catch(function (e) { m.textContent = e.message; })
      .then(function () { kb.disabled = false; });
  };
  document.getElementById('sadeceOdenen').onchange = ciz;
  document.getElementById('testGizle').onchange = ciz;
})();
