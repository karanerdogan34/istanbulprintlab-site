/* Yönetim: onaylı sipariş için imzalı PayTR ödeme bağlantısı üretir. Giriş, ana yönetim uygulamasındaki oturumla yapılır. */
(function () {
  var sonId = '';
  var f = document.getElementById('f'), m = document.getElementById('mesaj'), b = document.getElementById('olustur');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(f));
    m.textContent = ''; b.disabled = true; b.textContent = 'Oluşturuluyor…';
    fetch('/.netlify/functions/odeme-link', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-yonetim': '1' }, body: JSON.stringify(d) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (s) {
        if (!s.ok) throw new Error(s.j.message || 'Link oluşturulamadı.');
        sonId = s.j.id; document.getElementById('iptal').disabled = false; document.getElementById('iptal').textContent = 'Bu linki iptal et';
        document.getElementById('link').value = s.j.link;
        document.getElementById('testNot').textContent = s.j.test ? ' — TEST MODU: bu linkle gerçek tahsilat yapılmaz.' : '';
        document.getElementById('gecerlilik').textContent = 'Son geçerlilik: ' + new Date(s.j.gecerlilik).toLocaleString('tr-TR');
        var metin = 'Merhaba, ' + d.siparisNo + ' numaralı siparişiniz onaylandı. Kart ile (tek çekim veya taksitli) güvenli ödeme bağlantınız: ' + s.j.link;
        document.getElementById('wa').href = 'https://wa.me/?text=' + encodeURIComponent(metin);
        document.getElementById('sonuc').hidden = false;
        document.getElementById('sonuc').scrollIntoView({ behavior: 'smooth' });
      })
      .catch(function (er) { m.textContent = er.message; })
      .then(function () { b.disabled = false; b.textContent = 'Linki oluştur'; });
  });
  document.getElementById('iptal').addEventListener('click', function () {
    var bt = this;
    if (!sonId || !confirm('Bu ödeme linki iptal edilsin mi? Müşteri bu linkle artık ödeme yapamaz.')) return;
    fetch('/.netlify/functions/odeme-link', { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-yonetim': '1' }, body: JSON.stringify({ id: sonId }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (s) { if (!s.ok) throw new Error(s.j.message || 'İptal edilemedi.'); bt.textContent = 'Link iptal edildi'; bt.disabled = true; })
      .catch(function (er) { alert(er.message); });
  });
  document.getElementById('kopyala').addEventListener('click', function () {
    var t = document.getElementById('link'); t.select();
    (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(function () { this.textContent = 'Kopyalandı'; }.bind(this), function () { document.execCommand('copy'); });
  });
})();
