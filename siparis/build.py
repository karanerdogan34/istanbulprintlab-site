# -*- coding: utf-8 -*-
"""IPL web-to-print sipariş sayfaları derlemesi (test ortamı).
Kaynak: src/fiyatlar.json + src/motor.js + src/sablon-*.html → dist/<urun>/index.html (tek dosya, her şey gömülü)."""
import json, os, shutil
K = os.path.dirname(os.path.abspath(__file__))
oku = lambda p: open(os.path.join(K, p), encoding='utf-8').read()
F = json.loads(oku('src/fiyatlar.json'))


# Metinlerde fiyat yazmak için: {{metre_fiyat}}, {{tabaka.fiyat}} (ürünün kendi değeri) ya da {{genel.asgari_baski}}.
# Böylece telefondan fiyat değişince açıklama metinleri de kendiliğinden güncellenir.
def _deger(kok, yol):
    for p in yol.split('.'):
        kok = kok[int(p)] if isinstance(kok, list) else kok[p]
    if not isinstance(kok, (int, float)) or isinstance(kok, bool):
        raise ValueError('fiyat işareti sayı değil: ' + yol)
    return format(kok, ',').replace(',', '.')


def _isle(o, urun):
    if isinstance(o, dict):
        return {k: _isle(v, urun) for k, v in o.items()}
    if isinstance(o, list):
        return [_isle(v, urun) for v in o]
    if isinstance(o, str) and '{{' in o:
        return re.sub(r'\{\{([a-z0-9_.]+)\}\}', lambda m: _deger(F['genel'], m.group(1)[6:]) if m.group(1).startswith('genel.') else _deger(urun, m.group(1)), o)
    return o


import re
F['urunler'] = {k: _isle(u, u) for k, u in F['urunler'].items()}


# Telefon uygulamasından gelen fiyatlar için sunucu tarafı denetim: sıfır, eksi ya da sayı olmayan fiyat derlemeyi durdurur (canlı site eski haliyle kalır).
def _denetle():
    hata = []
    def bak(v, ad, lo=1, hi=200000):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
            hata.append('%s = %r' % (ad, v))
    bak(F['genel']['asgari_baski'], 'genel.asgari_baski', 0, 20000)
    bak(F['genel']['kargo_ucretsiz_esik'], 'genel.kargo_ucretsiz_esik', 0, 200000)
    for kod, u in F['urunler'].items():
        for i, m in enumerate(u.get('malzemeler', [])):
            if 'm2' in m: bak(m['m2'], '%s.malzemeler.%d.m2' % (kod, i), 0 if u['tur'] == 'duvar' else 1)
        for i, m in enumerate(u.get('kademeler', [])): bak(m['m2'], '%s.kademeler.%d.m2' % (kod, i))
        for i, m in enumerate(u.get('paketler', [])):
            for y in ('tek', 'cift'):
                if y in m: bak(m[y], '%s.paketler.%d.%s' % (kod, i, y))
        if 'metre_fiyat' in u: bak(u['metre_fiyat'], kod + '.metre_fiyat')
        if 'tabaka' in u: bak(u['tabaka']['fiyat'], kod + '.tabaka.fiyat')
        if 'kusgozu' in u: bak(u['kusgozu']['fiyat'], kod + '.kusgozu.fiyat')
        if 'laminasyon' in u: bak(u['laminasyon']['carpan'], kod + '.laminasyon.carpan', 1, 4)
        for o in (u.get('cerceve') or {}).get('olculer', []):
            for r, v in o.get('fiyat', {}).items(): bak(v, '%s.cerceve.%s.%s' % (kod, o['kod'], r))
    if hata:
        raise SystemExit('Geçersiz sipariş fiyatı: ' + ', '.join(hata))


_denetle()
motor = oku('src/motor.js')
css = oku('src/ortak.css')
kpdf = oku('src/kartvizit-pdf.js')
qr = oku('src/qrcode.min.js')
wa = oku('src/siparis-wa.js')
import re
YAYIN = bool(os.environ.get('YAYIN'))
CIKTI = os.environ.get('CIKTI') or os.path.join(K, 'dist')  # site derlemesi dist/siparis klasörüne yazdırır
# YAYIN=1 python3 build.py → test bandı kaldırılır
for kod, u in F['urunler'].items():
    s = oku('src/sablon-%s.html' % u['tur'])
    esik = F['genel']['kargo_ucretsiz_esik']
    kargo = u.get('kargo_metni') or ('Kargo ücreti alıcıya aittir; %s ₺ + KDV ve üzeri siparişlerde kargo ücretsizdir.%s Dilerseniz Kadıköy\'deki atölyemizden teslim alabilirsiniz.' % (format(esik, ',').replace(',', '.'), '' if u['tur'] in ('kartvizit', 'davetiye') else ' %s m²\'nin üzerindeki siparişlerde ücretsiz kargo uygulanmaz.' % F['genel']['kargo_max_m2']))
    # sayfaya yalnızca kendi ürününün fiyatları gömülür (daha hafif sayfa, daha hızlı açılış)
    for a, b in [('__CSS__', css), ('__MOTOR__', motor), ('__FIYATLAR__', json.dumps(dict(F, urunler={kod: u}), ensure_ascii=False)), ('__URUN__', kod),
                 ('__BASLIK__', u['ad']), ('__ACIKLAMA__', u.get('aciklama', '')), ('__KARGO_METNI__', kargo), ('__KPDF__', kpdf), ('__QR__', qr), ('__WA__', wa)]:
        s = s.replace(a, b)
    if YAYIN: s = re.sub(r'<div class="testbar">.*?</div>\n?', '', s)
    os.makedirs(os.path.join(CIKTI, kod), exist_ok=True)
    open(os.path.join(CIKTI, kod, 'index.html'), 'w', encoding='utf-8').write(s)
    if u['tur'] in ('kartvizit', 'davetiye'):  # baskı PDF'i için fontlar ve yazı motoru
        shutil.copytree(os.path.join(K, 'src', 'fontlar'), os.path.join(CIKTI, kod, 'fontlar'), dirs_exist_ok=True)
    print('derlendi:', kod)
