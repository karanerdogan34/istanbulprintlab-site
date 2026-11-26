/* Müşteri ödeme sayfası: imzalı bağlantıyı sunucuya doğrulatır, müşteri bilgilerini alır ve PayTR'ın güvenli ödeme çerçevesini açar. */
(function () {
  var API = '/.netlify/functions/odeme-baslat';
  var l = new URLSearchParams(location.search).get('l') || '';
  var $ = function (id) { return document.getElementById(id); };
  var bilgi = $('odBilgi'), form = $('odForm'), mesaj = $('odMesaj'), dugme = $('odDugme'), cerceve = $('odCerceve');
  var tl = function (k) { return (k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL'; };
  try { sessionStorage.setItem('ipl_odeme_link', location.href); } catch (e) {}

  form.querySelectorAll('input[name=faturaTuru]').forEach(function (r) {
    r.addEventListener('change', function () {
      var k = form.querySelector('input[name=faturaTuru]:checked').value === 'kurumsal';
      form.querySelectorAll('[data-kurumsal]').forEach(function (e) { e.hidden = !k; });
      form.querySelectorAll('[data-bireysel]').forEach(function (e) { e.hidden = k; });
    });
  });
  var wa = function (m) { return m + ' WhatsApp: +90 532 523 73 64'; };

  if (!l) { bilgi.textContent = 'Ödeme bağlantısı eksik. Lütfen size gönderdiğimiz bağlantıyı kullanın veya WhatsApp\'tan bize yazın.'; return; }

  fetch(API + '?l=' + encodeURIComponent(l)).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (s) {
      if (!s.ok) { bilgi.textContent = s.j.wa ? wa(s.j.message) : (s.j.message || 'Bağlantı geçersiz.'); return; }
      var d = s.j;
      bilgi.textContent = 'Aşağıdaki siparişin ödemesini kartınızla güvenle yapabilirsiniz. Tek çekim veya taksitli ödeme seçebilirsiniz.' + (d.test ? ' (TEST MODU — gerçek tahsilat yapılmaz)' : '');
      $('odNo').textContent = d.siparisNo;
      $('odAciklama').textContent = d.aciklama;
      $('odTutar').textContent = tl(d.kurus);
      if (d.kargoKurus > 0) { $('odUrun').textContent = tl(d.kurus - d.kargoKurus); $('odKargo').textContent = tl(d.kargoKurus); $('odKalem').hidden = false; }
      $('odTaksitNot').textContent = d.maxTaksit === 1 ? 'Bu sipariş için tek çekim ödeme alınır.'
        : 'Taksit seçenekleri ödeme ekranında kartınıza göre gösterilir' + (d.maxTaksit > 1 ? ' (en fazla ' + d.maxTaksit + ' taksit)' : '') + '. Taksitli ödemelerde bankanın vade farkı toplam tutara eklenir; tek çekimde yukarıdaki tutar çekilir.';
      $('odOzet').hidden = false;
      form.hidden = false;
      // Hesaplayıcıda yazılan ad ve telefon tekrar istenmez (müşteri değiştirebilir)
      try { var kisi = JSON.parse(localStorage.getItem('ipl_talep_kisi') || '{}') || {};
        if (kisi.ad && form.elements.ad && !form.elements.ad.value) form.elements.ad.value = kisi.ad;
        if (kisi.tel && form.elements.telefon && !form.elements.telefon.value) form.elements.telefon.value = kisi.tel; } catch (e) {}
    })
    .catch(function () { bilgi.textContent = 'Ödeme bilgileri alınamadı. Lütfen sayfayı yenileyin veya WhatsApp\'tan bize yazın.'; });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = new FormData(form);
    mesaj.textContent = '';
    dugme.disabled = true; dugme.textContent = 'Ödeme sayfası hazırlanıyor…';
    fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ l: l, ad: f.get('ad'), eposta: f.get('eposta'), telefon: f.get('telefon'), adres: f.get('adres'), faturaTuru: f.get('faturaTuru'), tckn: f.get('tckn'), unvan: f.get('unvan'), vergiDairesi: f.get('vergiDairesi'), vkn: f.get('vkn'), sozlesme: !!f.get('sozlesme') })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (s) {
        if (!s.ok || !s.j.token) { throw new Error(s.j.message || 'Ödeme sayfası açılamadı.'); }
        try { sessionStorage.setItem('ipl_odeme_oid', s.j.oid); } catch (e2) {}
        form.hidden = true;
        cerceve.hidden = false;
        var fr = document.createElement('iframe');
        fr.src = 'https://www.paytr.com/odeme/guvenli/' + encodeURIComponent(s.j.token);
        fr.id = 'paytriframe'; fr.title = 'PayTR güvenli ödeme';
        fr.setAttribute('frameborder', '0'); fr.setAttribute('scrolling', 'no');
        fr.style.width = '100%'; fr.style.minHeight = '620px'; fr.style.border = '0';
        cerceve.appendChild(fr);
        var sc = document.createElement('script');
        sc.src = 'https://www.paytr.com/js/iframeResizer.min.js';
        sc.onload = function () { try { window.iFrameResize({}, '#paytriframe'); } catch (er) {} };
        document.body.appendChild(sc);
        cerceve.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(function (er) {
        mesaj.textContent = er.message;
        dugme.disabled = false; dugme.textContent = 'Onayla ve ödemeye geç';
      });
  });
})();
