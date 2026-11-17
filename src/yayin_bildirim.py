# -*- coding: utf-8 -*-
"""Her yayının sonucunu site sahibine e-postayla bildirir.
Netlify'da derleme bitince sitenin kendi 'yayin-durumu' formuna gönderim yapılır;
Netlify bu formun gönderimlerini info@ adresine e-posta olarak iletir.
Yerelde (NETLIFY ortam değişkeni yoksa) hiçbir şey göndermez."""
import os, subprocess, urllib.parse, urllib.request

RAPOR = []  # derleme sırasında eklenen "neler değişti" satırları


def _son_degisiklik():
    try:
        r = subprocess.run(['git', 'log', '-1', '--format=%s%n%an'], capture_output=True, timeout=15)
        satir = r.stdout.decode('utf-8', 'replace').strip().splitlines()
        return satir[0] if satir else ''
    except Exception:
        return ''


def bildir(site, basarili, sebep=''):
    if os.environ.get('NETLIFY') != 'true' or os.environ.get('CONTEXT') != 'production':
        return
    degisiklik = _son_degisiklik()
    if basarili:
        durum = 'YAYINLANDI'
        aciklama = 'Değişikliğiniz kontrollerden geçti; sitede 1 dakika içinde görünür.'
    else:
        durum = 'YAYINLANMADI'
        aciklama = 'Değişiklik yayına alınmadı, canlı site eski haliyle duruyor. Paneli açıp aşağıdaki sebebi düzeltin ve tekrar kaydedin.'
    veri = {
        'form-name': 'yayin-durumu',
        'durum': durum,
        'aciklama': aciklama,
        'sebep': sebep or '-',
        'degisiklik': degisiklik or '-',
        'ayrinti': '\n'.join(RAPOR) or '-',
        'commit': (os.environ.get('COMMIT_REF') or '')[:7],
    }
    try:
        req = urllib.request.Request(site.rstrip('/') + '/yayin-durumu/', data=urllib.parse.urlencode(veri).encode('utf-8'),
                                     headers={'Content-Type': 'application/x-www-form-urlencoded'})
        urllib.request.urlopen(req, timeout=20).read()
        print('Yayın bildirimi gönderildi: %s' % durum)
    except Exception as e:
        print('Uyarı: yayın bildirimi gönderilemedi (%s)' % e)
