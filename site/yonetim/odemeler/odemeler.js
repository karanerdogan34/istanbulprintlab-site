/* Yönetim: ödeme kayıtları listesi. Metinler textContent ile yazılır (müşteri girdisi HTML olarak işlenmez). */
(function () {
  var V = [], liste = document.getElementById('liste'), m = document.getElementById('mesaj');
  var tl = function (k) { return (k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL'; };
  var DURUM = { basarili: 'ÖDENDİ', mukerrer: 'MÜKERRER ÖDEME — iade gerekebilir', inceleme: 'ÖDEME ALINDI — İNCELEYİN', basarisiz: 'Başarısız', baslatildi: 'Ödeme sayfası açıldı (sonuç yok)' };
  function el(etiket, metin, stil) { var e = document.createElement(etiket); if (metin != null) e.textContent = metin; if (stil) e.style.cssText = stil; return e; }
  function ciz() {
    var sadece = document.getElementById('sadeceOdenen').checked, testGizle = document.getElementById('testGizle').checked;
    var L = V.filter(function (d) { return (!sadece || d.durum === 'basarili' || d.durum === 'mukerrer' || d.durum === 'inceleme') && (!testGizle || !d.test); });
    liste.textContent = '';
    m.textContent = L.length ? L.length + ' kayıt' : 'Kayıt yok.';
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
      if (d.durum === 'basarisiz' && d.sonuc) k.appendChild(el('div', 'Sebep: ' + (d.sonuc.mesaj || d.sonuc.kod || '-'), 'font-size:13px;color:#777'));
      liste.appendChild(k);
    });
  }
  fetch('/.netlify/functions/odeme-liste', { method: 'POST', credentials: 'same-origin', headers: { 'x-yonetim': '1' } })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (s) { if (!s.ok) throw new Error(s.j.message || 'Liste alınamadı.'); V = s.j.odemeler || []; ciz(); })
    .catch(function (e) { m.textContent = e.message; });
  document.getElementById('sadeceOdenen').onchange = ciz;
  document.getElementById('testGizle').onchange = ciz;
})();
