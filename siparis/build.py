# -*- coding: utf-8 -*-
"""IPL web-to-print sipariş sayfaları derlemesi (test ortamı).
Kaynak: src/fiyatlar.json + src/motor.js + src/sablon-*.html → dist/<urun>/index.html (tek dosya, her şey gömülü)."""
import json, os, shutil
K = os.path.dirname(os.path.abspath(__file__))
oku = lambda p: open(os.path.join(K, p), encoding='utf-8').read()
F = json.loads(oku('src/fiyatlar.json'))
motor = oku('src/motor.js')
css = oku('src/ortak.css')
kpdf = oku('src/kartvizit-pdf.js')
for kod, u in F['urunler'].items():
    s = oku('src/sablon-%s.html' % u['tur'])
    esik = F['genel']['kargo_ucretsiz_esik']
    kargo = u.get('kargo_metni') or ('Kargo ücreti alıcıya aittir; %s ₺ + KDV ve üzeri siparişlerde kargo ücretsizdir.%s Dilerseniz Kadıköy\'deki atölyemizden teslim alabilirsiniz.' % (format(esik, ',').replace(',', '.'), '' if u['tur'] == 'kartvizit' else ' %s m²\'nin üzerindeki siparişlerde ücretsiz kargo uygulanmaz.' % F['genel']['kargo_max_m2']))
    for a, b in [('__CSS__', css), ('__MOTOR__', motor), ('__FIYATLAR__', json.dumps(F, ensure_ascii=False)), ('__URUN__', kod),
                 ('__BASLIK__', u['ad']), ('__ACIKLAMA__', u.get('aciklama', '')), ('__KARGO_METNI__', kargo), ('__KPDF__', kpdf)]:
        s = s.replace(a, b)
    os.makedirs(os.path.join(K, 'dist', kod), exist_ok=True)
    open(os.path.join(K, 'dist', kod, 'index.html'), 'w', encoding='utf-8').write(s)
    if u['tur'] == 'kartvizit':  # baskı PDF'i için fontlar ve yazı motoru
        shutil.copytree(os.path.join(K, 'src', 'fontlar'), os.path.join(K, 'dist', kod, 'fontlar'), dirs_exist_ok=True)
    print('derlendi:', kod)
