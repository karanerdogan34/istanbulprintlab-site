/* Yönetim: sipariş talepleri listesi. Müşteri girdileri textContent ile yazılır (HTML olarak işlenmez). */
(function () {
  var liste = document.getElementById('liste'), m = document.getElementById('mesaj'), gk = document.getElementById('google');
  var DOSYA = { yok: 'Dosya yok', yukleniyor: 'Dosya yükleniyor / tamamlanmadı', tamam: 'Dosya geldi', hata: 'DOSYA YÜKLENEMEDİ', baglanti: 'Dosya alınamadı (Drive bağlantısı yok)', kota: 'Dosya alınamadı (günlük kota doldu)' };
  function el(etiket, metin, stil) { var e = document.createElement(etiket); if (metin != null) e.textContent = metin; if (stil) e.style.cssText = stil; return e; }
  function bag(metin, href) { var a = el('a', metin, 'display:inline-block;margin:8px 8px 0 0;padding:8px 12px;border:1px solid #111;border-radius:999px;color:#111;text-decoration:none;font-size:14px'); a.href = href; if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; } return a; }
  var q = new URLSearchParams(location.search).get('google');
  var DONUS = { tamam: 'Google hesabı bağlandı. Talepler artık info@ adresine mail olarak gelecek, dosyalar Drive\'a yüklenecek.', hata: 'Google bağlantısı tamamlanamadı, tekrar deneyin.', 'yanlis-hesap': 'Yanlış hesap seçildi. Bağlarken info@istanbulprintlab.com hesabını seçin.' };
  function ciz(j) {
    gk.textContent = '';
    if (q && DONUS[q]) gk.appendChild(el('div', DONUS[q], 'font-weight:600;margin-bottom:6px;color:' + (q === 'tamam' ? '#1b7f3b' : '#c62828')));
    var go = j.google || {};
    gk.appendChild(el('div', go.bagli ? 'Google bağlı: ' + go.hesap + ' (mail + Drive çalışıyor)' : 'Google bağlı değil — talepler kaydediliyor ama MAİL GİTMİYOR ve dosya alınamıyor. ' + (go.neden || ''), 'color:' + (go.bagli ? '#1b7f3b' : '#c62828')));
    var b = bag(go.bagli ? 'Google bağlantısını yenile' : 'info@ Google hesabını bağla', '/.netlify/functions/google-baglan'); gk.appendChild(b);
    var L = j.talepler || [];
    liste.textContent = '';
    m.textContent = L.length ? L.length + ' talep' : 'Henüz talep yok.';
    L.forEach(function (k) {
      var d = k.dosya || { durum: 'yok' }, kart = el('div', null, 'border:1px solid #e4e4e0;border-radius:12px;padding:12px 14px;margin:0 0 10px;background:#fff');
      kart.appendChild(el('div', k.no + ' · ' + new Date(k.zaman).toLocaleString('tr-TR'), 'font-size:12px;color:#777'));
      kart.appendChild(el('div', k.urunAd + (k.toplam ? ' — ' + k.toplam : ''), 'font-weight:600;margin-top:2px'));
      kart.appendChild(el('div', k.telefon + (k.ad ? ' · ' + k.ad : ''), 'font-size:15px;margin-top:4px'));
      kart.appendChild(el('div', DOSYA[d.durum] + (d.ad ? ': ' + d.ad + ' (' + (d.boyut < 1048576 ? Math.max(1, Math.round(d.boyut / 1024)) + ' KB' : (d.boyut / 1048576).toFixed(1) + ' MB') + ')' : ''), 'font-size:13px;margin-top:4px;color:' + (d.durum === 'tamam' ? '#1b7f3b' : d.durum === 'yok' ? '#777' : '#c62828')));
      if (k.mail && !k.mail.ilk) kart.appendChild(el('div', 'Bu talep için mail gönderilemedi.', 'font-size:13px;color:#c62828'));
      if (k.not) kart.appendChild(el('div', 'Not: ' + k.not, 'font-size:14px;margin-top:4px'));
      var det = el('details', null, 'margin-top:6px'); det.appendChild(el('summary', 'Seçimler', 'font-size:14px;cursor:pointer'));
      det.appendChild(el('pre', k.ozet, 'white-space:pre-wrap;font:13px/1.45 system-ui;margin:6px 0 0')); kart.appendChild(det);
      kart.appendChild(bag('Ara', 'tel:+' + k.tel));
      kart.appendChild(bag('WhatsApp', 'https://wa.me/' + k.tel + '?text=' + encodeURIComponent('Merhaba, istanbulprintlab.com üzerinden gönderdiğiniz ' + k.no + ' numaralı sipariş talebiniz hakkında yazıyoruz.')));
      if (d.link) kart.appendChild(bag('Dosyayı aç', d.link));
      liste.appendChild(kart);
    });
  }
  fetch('/.netlify/functions/talep-liste', { method: 'POST', credentials: 'same-origin', headers: { 'x-yonetim': '1' } })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (s) { if (!s.ok) throw new Error(s.j.message || 'Liste alınamadı.'); ciz(s.j); })
    .catch(function (e) { m.textContent = e.message; });
})();
