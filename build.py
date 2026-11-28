# -*- coding: utf-8 -*-
"""IstanbulPrintLab site derlemesi.
Kaynak: site/ (fiyatlar {{anahtar}} işaretli) + content/*.json (yönetim panelinden düzenlenir)
Çıktı: dist/ — Netlify yalnızca dist/ klasörünü yayınlar.
Çalıştırma: python3 build.py
"""
import glob, html, json, os, re, shutil, sys, urllib.parse, urllib.request
from decimal import Decimal, ROUND_HALF_UP

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, 'src'))
import sayfalar as S  # noqa: E402
import yayin_bildirim as YB  # noqa: E402

E = html.escape
DIST = 'dist'


def oku(p):
    return open(p, encoding='utf-8').read()


def yaz(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf-8').write(s)


def js(p):
    return json.load(open(p, encoding='utf-8'))


# ---------- anasayfa proje kartları ----------
KART = '''<a href="{href}"><div class="clip"><img class="ph" src="{src}" alt="{alt}" loading="lazy" style="height:420px"></div><div><span class="tag">{tag}</span><h3>{t}</h3><p>{d}{oku}</p></div></a>'''


def projeler_html():
    out = []
    for p in js('content/projeler.json').get('projeler', []):
        if p.get('gizle') or not p.get('gorsel'):
            continue
        link = (p.get('baglanti') or '').strip()
        out.append(KART.format(
            href=S.guvenli_url(link or '#teklif'), src=S.gorsel(p['gorsel']),
            alt=E(p.get('alt') or '%s — %s' % (p.get('baslik', ''), p.get('aciklama', ''))),
            tag=E(p.get('etiket', '')), t=E(p.get('baslik', '')), d=E(p.get('aciklama', '')),
            oku=' <b>Vaka çalışmasını oku →</b>' if link else ''))
    return '\n' + '\n'.join(out) + '\n'


# ---------- anasayfa ürün düğmeleri (sipariş sayfalarının fiyat dosyasından) ----------
DUGMELER = [  # (sipariş ürün kodu, sitedeki sayfa, düğme adı)
    ('folyo-baski', '/folyo-baski/', 'Folyo baskı'), ('branda-baski', '/branda-baski/', 'Branda baskı'),
    ('sticker-etiket-baski', '/sticker-baski/', 'Sticker / etiket'), ('one-way-vision-baski', '/one-way-vision/', 'One way vision'),
    ('folyo-yazi-kesim', '/folyo-yazi-kesim/', 'Folyo yazı kesim'), ('foreks-baski', '/foreks-baski/', 'Foreks baskı'),
    ('fotoblok-baski', '/fotoblok-baski/', 'Fotoblok baskı'), ('afis-baski', '/afis-baski/', 'Afiş baskı'),
    ('kartvizit-baski', '/kartvizit-baski/', 'Kartvizit'), ('poster-baski', '/poster-baski/', 'Poster baskı'),
    ('mesh-baski', '/mesh-branda/', 'Mesh baskı'), ('soguk-dtf-baski', '/soguk-dtf-baski/', 'UV DTF'),
    ('sicak-dtf-baski', '/sicak-dtf-baski/', 'Sıcak DTF'), ('duvar-kagidi-baski', '/duvar-kagidi-baski/', 'Duvar kağıdı'),
    ('davetiye-baski', '/davetiye-baski/', 'Davetiye')]


def _tl(n):
    return '{:,}'.format(int(n)).replace(',', '.') + ' ₺'


def baslangic_fiyati(u):
    t = u['tur']
    if t in ('rulo', 'duvar'):
        f = [m['m2'] for m in u.get('malzemeler', []) if isinstance(m.get('m2'), (int, float)) and m['m2'] > 0]
        birim = '/ m²'
        if not f:
            return ''
        return '%s + KDV %s%s' % (_tl(min(f)), birim, "'den" if len(set(f)) > 1 else '')
    if t == 'yazi':
        return '%s + KDV / m²\'den' % _tl(min(k['m2'] for k in u['kademeler']))
    if t == 'dtf':
        return ('%s + KDV / metre' % _tl(u['metre_fiyat'])) if u.get('metre_fiyat') else ('%s + KDV / tabaka' % _tl(u['tabaka']['fiyat']))
    if t in ('kartvizit', 'davetiye'):
        p = u['paketler'][0]
        return '%s + KDV\'den' % _tl(min(v for k, v in p.items() if k in ('tek', 'cift')))
    return ''


URUN_GORSEL_ALT = {  # ürün kartı fotoğrafları: ürün, kullanıldığı yerde ve gerçek ölçeğinde
    'folyo-baski': 'Butik vitrin camını baştan sona kaplayan baskılı folyo', 'branda-baski': 'Şantiyeyi saran baskılı branda inşaat paravanı',
    'sticker-etiket-baski': 'Dizüstü bilgisayara yapıştırılan kesimli sticker', 'one-way-vision-baski': 'Ofis camında delikli one way vision baskı',
    'folyo-yazi-kesim': 'Kafe vitrininde beyaz folyo yazı kesim ve açılış saatleri', 'foreks-baski': 'Ofis duvarında distans vidalı foreks levhalar',
    'fotoblok-baski': 'AVM koridorunda ayakta duran dekupe fotoblok figür', 'afis-baski': 'Apartman balkonuna dört köşesinden iple gerdirilmiş SAHİBİNDEN SATILIK yazılı branda afiş',
    'kartvizit-baski': 'Elde tutulan kalın kartvizit destesi', 'poster-baski': 'Oturma odası duvarında çerçevesiz poster baskı',
    'mesh-baski': 'Bina cephesini kaplayan delikli mesh baskı', 'soguk-dtf-baski': 'Kupaya uygulanan UV DTF baskı, taşıyıcı film soyulurken',
    'sicak-dtf-baski': 'Tişörte ütüyle uygulanan sıcak DTF transfer baskı', 'duvar-kagidi-baski': 'Çocuk odası duvarında baskılı duvar kağıdı',
    'davetiye-baski': 'Masada zarf ve mühürle düğün davetiyesi'}


def urun_dugmeleri_html(A):
    F = js('siparis/src/fiyatlar.json')['urunler']
    liste = A.get('urun_dugmeleri') or [dict(kod=k, yol=y, ad=a, goster=True) for k, y, a in DUGMELER]
    out = []
    for i, d in enumerate(liste):
        if d.get('goster') is False or d.get('kod') not in F:
            continue
        kod = d['kod']
        fy = baslangic_fiyati(F[kod]).split(' + ', 1)
        fiyat = ' '.join('<span>%s</span>' % E(x) for x in [fy[0]] + (['+ ' + fy[1]] if len(fy) > 1 else []))
        g = d.get('gorsel') or ''
        if g:
            img = '<img src="%s" alt="%s" loading="lazy" decoding="async" width="720" height="960">' % (S.gorsel(g), S.attr(d.get('gorsel_aciklama') or d.get('ad', '')))
        else:
            b = '/img/urun/%s' % kod
            img = ('<img src="%s-720.jpg" srcset="%s-360.webp 360w, %s-720.webp 720w" sizes="(max-width:760px) 46vw, (max-width:1180px) 30vw, 220px" alt="%s" %s decoding="async" width="720" height="960">'
                   % (b, b, b, E(URUN_GORSEL_ALT.get(kod, d.get('ad', ''))), 'fetchpriority="high"' if i < 2 else 'loading="lazy"'))
        not_ = '<em class="ukart-et">Kargo yok · atölyeden teslim veya nakliye</em>' if F[kod].get('kargo_yok') else ''
        out.append('<a class="ukart" href="%s" data-kod="%s" data-ad="%s"><span class="ukutu">%s</span><b>%s</b><small>%s</small>%s</a>' % (
            S.guvenli_url(d['yol']), E(kod), E(d.get('ad', '')), img, E(d.get('ad', '')), fiyat, not_))
    return '\n' + '\n'.join(out) + '\n'


def one_cikanlar_html(A):
    out = []
    for d in A.get('one_cikanlar') or []:
        if d.get('goster') is False:
            continue
        out.append('<article class="card"><img class="oc-img" src="%s" alt="%s" loading="lazy"><div class="in">%s<h3 style="font-size:19px">%s</h3><p class="muted" style="font-size:15px">%s</p>%s<a href="%s" class="btn sm">%s</a></div></article>' % (
            S.gorsel(d.get('gorsel')), S.attr(d.get('gorsel_aciklama') or d.get('baslik')), ('<span class="tag">%s</span>' % S.m2h(d['ust_yazi'])) if d.get('ust_yazi') else '',
            S.m2h(d.get('baslik')), S.m2h(d.get('aciklama')), ('<p class="price" style="margin-top:auto">%s</p>' % S.m2h(d['fiyat'])) if d.get('fiyat') else '<p style="margin-top:auto"></p>',
            S.guvenli_url(d.get('baglanti') or '#teklif'), S.m2h(d.get('dugme') or 'İncele')))
    return '\n' + '\n'.join(out) + '\n'


def ne_yapiyoruz_html(A):
    out = []
    for d in A.get('ne_yapiyoruz') or []:
        if d.get('goster') is False:
            continue
        h = d.get('baglanti') or '#teklif'
        out.append('<a href="%s"%s><div class="clip"><img class="ph" src="%s" alt="%s" loading="lazy"></div><div><span class="tag">%s</span><h3>%s</h3><p>%s</p></div></a>' % (
            S.guvenli_url(h), ' target="_blank" rel="noopener"' if h.startswith('http') else '', S.gorsel(d.get('gorsel')), S.attr(d.get('gorsel_aciklama') or d.get('baslik')),
            S.m2h(d.get('etiket') or 'Teklif ile'), S.m2h(d.get('baslik')), S.m2h(d.get('aciklama'))))
    return '\n' + '\n'.join(out) + '\n'


# ---------- projeler galerisi (content/galeri.json) ----------
GALERI_STIL = ('<style>.gk{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.galeri{columns:3 300px;column-gap:16px;margin-top:32px}'
               '.galeri figure{break-inside:avoid;margin:0 0 16px}.galeri img,.galeri video{width:100%;height:auto;border-radius:6px;display:block;cursor:zoom-in;background:var(--stone)}'
               '.galeri figcaption{font-size:14px;color:var(--mute);margin-top:6px}.buyut{position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;z-index:200;padding:20px;cursor:zoom-out}'
               '.buyut img{max-width:100%;max-height:100%;border-radius:4px}.refs{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--soft);font-size:16px;margin-top:10px}</style>')
BUYUT_JS = ("<script>document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[data-buyut]');if(!a)return;e.preventDefault();"
            "var d=document.createElement('div');d.className='buyut';d.innerHTML='<img alt=\"\">';d.firstChild.src=a.href;d.firstChild.alt=a.dataset.alt||'';"
            "d.addEventListener('click',function(){d.remove()});document.addEventListener('keydown',function k(ev){if(ev.key==='Escape'){d.remove();document.removeEventListener('keydown',k)}});document.body.appendChild(d)});</script>")


def kabuk(sablon, yol, baslik, aciklama, ad, ana):
    """Afiş sayfasının iskeletiyle (başlık, menü, teklif formu, alt bilgi) yeni sayfa üretir."""
    s = sablon
    t0 = re.search(r'<title>(.*?)</title>', s).group(1)
    d0 = re.search(r'<meta name="description" content="([^"]*)">', s).group(1)
    s = s.replace('<title>%s</title>' % t0, '<title>%s</title>' % E(baslik, quote=False))
    s = s.replace('content="%s"' % t0, 'content="%s"' % E(baslik)).replace('content="%s"' % d0, 'content="%s"' % E(aciklama))
    s = re.sub(r'<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n', '', s)
    s = s.replace('https://www.istanbulprintlab.com/afis-baski/', 'https://www.istanbulprintlab.com%s' % yol)
    s = re.sub(r'<script type="application/ld\+json">\{"@context": "https://schema.org", "@type": "FAQPage".*?</script>\n', '', s, flags=re.S)
    s = s.replace('"name": "Afiş baskı"', '"name": %s' % json.dumps(ad, ensure_ascii=False))
    a, b = s.index('<main id="icerik">'), s.index('</main>')
    s = s[:a] + '<main id="icerik">\n' + ana + '\n' + s[b:]
    return s.replace(' data-en="en-poster-printing"', '').replace('href="/en/poster-printing/"', 'href="/en/"')


def galeri():
    G = {'kategoriler': sorted((js(f) for f in glob.glob('content/galeri/*.json')), key=lambda k: (k.get('sira', 999), k.get('baslik', ''))), 'referanslar': js('content/anasayfa.json').get('referanslar', [])}
    sablon = oku('site/afis-baski/index.html')
    kats = G.get('kategoriler', [])
    refs = ''.join('<span>%s</span>' % E(r) for r in G.get('referanslar', []))
    def kapak(k):
        return next((x['gorsel'] for x in k.get('isler', []) if x.get('gorsel') and not x['gorsel'].endswith('.mp4')), '')
    kartlar = ''.join('<a href="/galeri/%s/"><div class="clip"><img class="ph" src="%s" alt="%s" loading="lazy"></div><div><span class="tag">%d iş</span><h3>%s</h3><p>%s</p></div></a>\n' % (
        k['slug'], S.gorsel(kapak(k)), E(k['baslik']), len(k.get('isler', [])), E(k['baslik']), E(k.get('giris', ''))) for k in kats if kapak(k))
    sm = oku('%s/sitemap.xml' % DIST)
    for k in kats:
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', k['slug']):
            raise S.IcerikHatasi('Galeri kategori adresi geçersiz: %r' % k['slug'])
        diger = ''.join('<a class="chip" href="/galeri/%s/"%s>%s</a>' % (x['slug'], ' style="background:var(--ink);color:#fff;border-color:var(--ink)" aria-current="page"' if x is k else '', E(x['baslik'])) for x in kats)
        isler = []
        for x in k.get('isler', []):
            g = x.get('gorsel', '')
            if g.endswith('.mp4'):
                isler.append('<figure><video src="%s" controls preload="none" playsinline%s></video><figcaption>%s</figcaption></figure>' % (E(g), (' poster="%s"' % S.gorsel(x['kapak'])) if x.get('kapak') else '', E(x.get('aciklama', ''))))
            else:
                isler.append('<figure><a href="%s" data-buyut data-alt="%s"><img src="%s" alt="%s" loading="lazy"></a><figcaption>%s</figcaption></figure>' % (S.gorsel(g), E(x.get('aciklama', '')), S.gorsel(g), E(x.get('aciklama', '')), E(x.get('aciklama', ''))))
        ana = ('<div class="wrap crumbs"><a href="/">Ana sayfa</a> / <a href="/galeri/">Projeler</a> / %s</div>\n%s\n<section class="wrap" style="padding-top:20px;padding-bottom:88px">\n'
               '<h1>%s</h1>\n<p class="lead" style="margin-top:10px;max-width:760px">%s</p>\n<div class="gk">%s</div>\n<div class="galeri">\n%s\n</div>\n'
               '<p class="lead" style="margin-top:28px">Benzer bir iş mi düşünüyorsunuz? <a class="link" href="#teklif">Teklif alın →</a></p>\n</section>\n%s'
               % (E(k['baslik']), GALERI_STIL, E(k['baslik']), E(k.get('giris', '')), diger, '\n'.join(isler), BUYUT_JS))
        yaz('%s/galeri/%s/index.html' % (DIST, k['slug']), kabuk(sablon, '/galeri/%s/' % k['slug'], '%s — Projelerimiz | IstanbulPrintLab' % k['baslik'], k.get('giris', ''), k['baslik'], ana))
        if '/galeri/%s/<' % k['slug'] not in sm:
            sm = sm.replace('</urlset>', '  <url><loc>https://www.istanbulprintlab.com/galeri/%s/</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>\n</urlset>' % k['slug'])
    ana = ('<div class="wrap crumbs"><a href="/">Ana sayfa</a> / Projeler</div>\n%s\n<section class="wrap" style="padding-top:20px">\n<h1>Projelerimiz ve referanslarımız</h1>\n'
           '<p class="lead" style="margin-top:10px;max-width:760px">Kadıköy\'deki atölyemizde ürettiğimiz ve uyguladığımız işlerden seçmeler. Kategoriye tıklayın, fotoğrafları görün.</p>\n'
           '<div class="grid g3 svc" style="margin-top:32px">\n%s</div>\n<h2 class="h2" style="font-size:32px;margin-top:64px">Son projeler ve vaka çalışmaları</h2>\n<div class="grid g3 svc" style="margin-top:24px">%s</div>\n'
           '<h2 class="h2" style="font-size:32px;margin-top:64px">Referanslarımızdan bazıları</h2>\n<div class="refs">%s</div>\n</section>\n<div style="height:88px"></div>'
           % (GALERI_STIL, kartlar, projeler_html(), refs))
    yaz('%s/galeri/index.html' % DIST, kabuk(sablon, '/galeri/', 'Projelerimiz ve Referanslarımız | IstanbulPrintLab', 'IstanbulPrintLab projeleri: folyo, branda, fotoblok, tabela ve afiş işlerimizden fotoğraflar ve referanslarımız.', 'Projeler', ana))
    if '/galeri/<' not in sm:
        sm = sm.replace('</urlset>', '  <url><loc>https://www.istanbulprintlab.com/galeri/</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>\n</urlset>')
    yaz('%s/sitemap.xml' % DIST, sm)
    return kartlar, refs


# ---------- fiyatlar ----------
TOK = re.compile(r'\{\{([a-z0-9_]+)(?:\*([\d.]+))?(\+kdv|:ham)?\}\}')
HER_TOK = re.compile(r'\{\{[^{}]{0,40}\}\}')
KDV_DAHIL = {'takvim_cerceveli'}
# Her fiyat için makul aralık (TL). Dışında kalan değer derlemeyi durdurur.
ARALIK = {'asgari': (0, 20000), 'kargo_esik': (0, 200000), 'kargo_ucreti': (0, 5000), 'kargo_max_m2': (1, 1000), 'rollup': (500, 50000)}
VARSAYILAN_ARALIK = (50, 30000)


class FiyatHatasi(Exception):
    pass


def fiyatlari_dogrula(P):
    for k, v in P.items():
        if k in ('buyuk_degisiklik_onay', 'buyuk_onay'):
            continue
        if isinstance(v, float) and v.is_integer():
            P[k] = v = int(v)
        if not isinstance(v, int) or isinstance(v, bool):
            raise FiyatHatasi('"%s" fiyatı tam sayı olmalı (girilen: %r).' % (k, v))
        lo, hi = ARALIK.get(k, VARSAYILAN_ARALIK)
        if not lo <= v <= hi:
            raise FiyatHatasi('"%s" fiyatı %s olamaz; %s ile %s arasında olmalı.' % (k, v, lo, hi))


def siparis_fiyatlari():
    """Sitedeki eski fiyat kısaltmalarını ({{folyo}} vb.) sipariş hesaplayıcılarının fiyat dosyasından türetir.
    Telefondan "Sipariş fiyatları"nda bir fiyat değişince hesaplayıcı, anasayfa düğmesi ve sayfa metinleri birlikte değişir."""
    F = js('siparis/src/fiyatlar.json')
    U, G = F['urunler'], F['genel']
    m2 = lambda kod, mk=None: next(m['m2'] for m in U[kod]['malzemeler'] if mk is None or m['kod'] == mk)
    lam = lambda kod: U[kod]['laminasyon']['carpan']
    d = {
        'sticker': m2('sticker-etiket-baski'), 'folyo': m2('folyo-baski'), 'owv': m2('one-way-vision-baski'),
        'foreks': m2('foreks-baski', '3mm'), 'branda_beyaz': m2('branda-baski', 'branda-arkasi-beyaz'),
        'branda_siyah': m2('branda-baski', 'branda-arkasi-siyah'), 'mesh': m2('mesh-baski'),
        'asgari': G['asgari_baski'], 'kargo_esik': G['kargo_ucretsiz_esik'], 'kargo_ucreti': G['kargo_ucreti'], 'kargo_max_m2': G['kargo_max_m2'],
    }
    d['folyo_lam'] = int(round(d['folyo'] * lam('folyo-baski')))
    d['foreks_lam'] = int(round(d['foreks'] * lam('foreks-baski')))
    return d


def onceki_fiyatlar():
    # 1) Netlify'ın bir önceki başarılı yayınının commit'i, 2) bir önceki commit, 3) canlı site
    import subprocess
    for ref in [os.environ.get('CACHED_COMMIT_REF'), 'HEAD~1']:
        if not ref:
            continue
        try:
            out = subprocess.run(['git', 'show', '%s:content/fiyatlar.json' % ref], capture_output=True, timeout=20)
            if out.returncode == 0:
                return json.loads(out.stdout.decode('utf-8'))
        except Exception:
            pass
    try:
        with urllib.request.urlopen('https://www.istanbulprintlab.com/fiyatlar.json', timeout=15) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as e:  # ilk yayında ya da erişilemezse karşılaştırma yapılmaz
        print('Uyarı: önceki fiyatlar okunamadı (%s); büyük değişiklik kontrolü atlandı.' % e)
        return None


def fiyat_raporu(P, eski):
    if not eski:
        return
    buyuk = []
    turetilen = set(siparis_fiyatlari())  # bunlar telefonda "Sipariş fiyatları"nda ayrıca onaylanır
    for k, v in P.items():
        if k in ('buyuk_degisiklik_onay', 'buyuk_onay') or k in turetilen or k not in eski or not isinstance(eski.get(k), int):
            continue
        if v != eski[k]:
            oran = (v - eski[k]) * 100.0 / eski[k] if eski[k] else 100.0
            satir = 'Fiyat değişti: %s %s → %s TL (%+.1f%%)' % (k, eski[k], v, oran)
            print(satir)
            YB.RAPOR.append(satir)
            # Yönetim uygulamasında sahip bu değişikliği tam olarak (eski → yeni) onayladıysa geçerlidir.
            onay = (P.get('buyuk_onay') or {}).get(k) if isinstance(P.get('buyuk_onay'), dict) else None
            if abs(oran) > 50 and onay != [eski[k], v]:
                buyuk.append('%s: %s → %s' % (k, eski[k], v))
    # Tarih bazlı genel onay kaldırıldı: büyük değişiklik yalnızca o değişikliğe bağlı onayla (buyuk_onay) geçer.
    if buyuk:
        raise FiyatHatasi('%%50\'den büyük fiyat değişikliği: %s. Doğruysa telefon uygulamasında Fiyatlar ekranından bu değişikliği onaylayarak yapın.' % ', '.join(buyuk))


def fiyat_isle(s, P, dosya=''):
    def r(m):
        k, carpan, tur = m.group(1), m.group(2), m.group(3)
        if k not in P or k in ('buyuk_degisiklik_onay', 'buyuk_onay'):
            raise FiyatHatasi('%s: tanınmayan fiyat kısaltması {{%s}}' % (dosya, k))
        if tur == '+kdv' and k in KDV_DAHIL:
            raise FiyatHatasi('%s: {{%s+kdv}} kullanılamaz; bu fiyat zaten KDV dahil.' % (dosya, k))
        n = Decimal(P[k]) * Decimal(carpan or '1')
        if tur == '+kdv':
            n = n * Decimal('1.2')
        n = int(n.quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        return str(n) if tur == ':ham' else '{:,}'.format(n).replace(',', '.')
    out = TOK.sub(r, s)
    bozuk = [x for x in HER_TOK.findall(out) if not x.startswith('{{fields.')]
    if bozuk:
        raise FiyatHatasi('%s: hatalı yazılmış fiyat kısaltması: %s' % (dosya, ', '.join(sorted(set(bozuk))[:5])))
    return out


# ---------- iletişim ----------
ESKI = {'telefon': '+90 532 523 73 64', 'eposta': 'info@istanbulprintlab.com',
        'adres': 'Fikirtepe Mah. Dispanser Sok. No:50/A-B', 'ilce': 'Kadıköy'}


def tel(t):
    d = re.sub(r'\D', '', t)
    if d.startswith('0'):
        d = '90' + d[1:]
    if not d.startswith('90'):
        d = '90' + d
    g = '+90 %s %s %s %s' % (d[2:5], d[5:8], d[8:10], d[10:]) if len(d) == 12 else '+' + d
    return g, '+' + d, d


def iletisim_ciftleri():
    yeni = dict(ESKI)
    yeni.update({k: (v or '').strip() for k, v in js('content/iletisim.json').items() if (v or '').strip()})
    if yeni == ESKI:
        return []
    (og, op, od), (ng, np_, nd) = tel(ESKI['telefon']), tel(yeni['telefon'])
    c = [(og, ng), (op, np_), (od, nd), (ESKI['eposta'], yeni['eposta']), (ESKI['adres'], yeni['adres']),
         (', %s / ' % ESKI['ilce'], ', %s / ' % yeni['ilce']),
         ('"addressLocality":"%s"' % ESKI['ilce'], '"addressLocality":"%s"' % yeni['ilce'])]
    return [(a, b) for a, b in c if a != b]


# ---------- vaka çalışmaları ----------
def vakalar():
    sablon = oku('site/projeler/antre-gourmet/index.html')
    sluglar = []
    for f in sorted(glob.glob('content/vakalar/*.json')):
        d = js(f)
        if d.get('taslak'):
            continue
        sl = (d.get('slug') or os.path.splitext(os.path.basename(f))[0]).strip()
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', sl):
            raise S.IcerikHatasi('Vaka sayfa adresi geçersiz: %r (yalnızca küçük harf, rakam ve tire)' % sl)
        if sl in [x for x, _ in sluglar]:
            raise S.IcerikHatasi('Aynı sayfa adresi iki vaka çalışmasında kullanılmış: %s' % sl)
        d['slug'] = sl
        sluglar.append((d['slug'], d))
        yaz('%s/projeler/%s/index.html' % (DIST, d['slug']), S.uret_vaka(sablon, 'antre-gourmet', d))
    if 'antre-gourmet' not in [x for x, _ in sluglar]:
        shutil.rmtree('%s/projeler/antre-gourmet' % DIST, ignore_errors=True)
    # site haritası: silinen projeleri çıkar, yenilerini ekle (mevcut satırlar yerinde kalır)
    sm = oku('%s/sitemap.xml' % DIST)
    var = set(re.findall(r'https://www\.istanbulprintlab\.com/projeler/([^/<]+)/', sm))
    yeni = [x for x, _ in sluglar]
    yonlendir = ''
    for sl in sorted(var - set(yeni)):
        yonlendir += '/projeler/%s/ /#projeler 301\n' % sl
        sm = re.sub(r'\n?[ \t]*<url><loc>https://www\.istanbulprintlab\.com/projeler/%s/</loc>.*?</url>' % re.escape(sl), '', sm, flags=re.S)
    ek = ''.join('  <url><loc>https://www.istanbulprintlab.com/projeler/%s/</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>\n' % sl for sl in yeni if sl not in var)
    if ek:
        sm = sm.replace('</urlset>', ek + '</urlset>')
    yaz('%s/sitemap.xml' % DIST, sm)
    # Silinen (ya da adı değişen) her vaka sayfası, geçmişte yayınlanmış olsun olmasın, proje bölümüne yönlenir.
    # Netlify bu kuralı yalnızca o adreste dosya yoksa uygular; mevcut vaka sayfaları etkilenmez.
    yaz('%s/_redirects' % DIST, yonlendir + oku('%s/_redirects' % DIST).rstrip('\n') + '\n/projeler/*  /#projeler  301\n')


def ic_baglanti_kontrol():
    eksik = set()
    for kok, _, fs in os.walk(DIST):
        for f in fs:
            if not f.endswith('.html'):
                continue
            for h in re.findall(r'href="(/[^"#?]*)', oku(os.path.join(kok, f))):
                if h.startswith('//') or '.' in h.rsplit('/', 1)[-1]:
                    if os.path.splitext(h)[1] and not os.path.exists(DIST + h):
                        eksik.add(h)
                    continue
                if not (os.path.exists(DIST + h.rstrip('/') + '/index.html') or os.path.exists(DIST + h) or h == '/'):
                    eksik.add(h)
    return eksik


# ---------- ürün sayfaları: Product + Offer yapısal verisi (fiyat her derlemede siparis/src/fiyatlar.json'dan okunur) ----------
URUN_SEMA = {  # sayfa yolu -> hesaplayıcı kodu (None: sabit fiyat content/fiyatlar.json'dan)
    'sticker-baski': 'sticker-etiket-baski', 'seffaf-sticker-baski': 'sticker-etiket-baski', 'logo-sticker-baski': 'sticker-etiket-baski',
    'folyo-baski': 'folyo-baski', 'branda-baski': 'branda-baski', 'one-way-vision': 'one-way-vision-baski', 'folyo-yazi-kesim': 'folyo-yazi-kesim',
    'foreks-baski': 'foreks-baski', 'fotoblok-baski': 'fotoblok-baski', 'afis-baski': 'afis-baski', 'kartvizit-baski': 'kartvizit-baski',
    'poster-baski': 'poster-baski', 'mesh-branda': 'mesh-baski', 'soguk-dtf-baski': 'soguk-dtf-baski', 'sicak-dtf-baski': 'sicak-dtf-baski',
    'duvar-kagidi-baski': 'duvar-kagidi-baski', 'davetiye-baski': 'davetiye-baski', 'roll-up-baski': None, 'dekupe-figur': None}


def urun_fiyat_sayi(u):
    """(en düşük fiyat KDV hariç, birim, 'den mi) — baslangic_fiyati ile aynı mantık."""
    t = u['tur']
    if t in ('rulo', 'duvar'):
        f = [m['m2'] for m in u.get('malzemeler', []) if isinstance(m.get('m2'), (int, float)) and m['m2'] > 0]
        return (min(f), 'MTK', len(set(f)) > 1) if f else None
    if t == 'yazi':
        return (min(k['m2'] for k in u['kademeler']), 'MTK', True)
    if t == 'dtf':
        return (u['metre_fiyat'], 'MTR', False) if u.get('metre_fiyat') else (u['tabaka']['fiyat'], 'tabaka', False)
    if t in ('kartvizit', 'davetiye'):
        p = u['paketler'][0]
        return (min(v for k, v in p.items() if k in ('tek', 'cift')), 'paket', True)
    return None


KISACA_STIL = ('<style>.kisaca{margin:18px 0 4px;border:1px solid var(--line,#DCD3C2);border-radius:12px;background:#fff}'
               '.kisaca caption{caption-side:top;text-align:left;font-weight:600;padding:10px 0 6px;font-size:15px}'
               '.kisaca{width:100%;border-collapse:separate;font-size:15px}.kisaca th,.kisaca td{padding:8px 0;border-bottom:1px solid var(--line,#E7DFD2);vertical-align:top;text-align:left}'
               '.conf>.kisaca{order:1}.kisaca tr:last-child th,.kisaca tr:last-child td{border-bottom:0}.kisaca th{width:38%;font-weight:500;color:var(--mute,#6B6258);padding-left:14px;padding-right:12px}.kisaca td{padding-right:14px}</style>')


def kisaca_satirlari(yol, kod, F, C, G):
    """Ürün sayfası 'Kısaca' kutusu: fiyat, en az sipariş, ölçü, teslim, malzeme — hepsi fiyat dosyasından."""
    def tl(x):
        return ('{:,.0f}'.format(x)).replace(',', '.') + ' ₺'
    asgari = '%s + KDV' % tl(G['asgari_baski'])
    std = 'Dosya ve ödeme onayından sonra 1–2 iş gününde kargoda'
    if not kod:
        if yol == 'roll-up-baski':
            return [('Fiyat', '%s + KDV (85 × 200 cm, mekanizma ve çanta dahil)' % tl(C['rollup'])), ('Teslim', std)]
        return [('Fiyat', "%s + KDV'den başlar; ölçüye ve kesime göre değişir" % tl(C['dekupe'])), ('Teslim', 'Ölçüye göre; sipariş onayında bildirilir')]
    u = F[kod]
    t = u['tur']
    bf = baslangic_fiyati(u).replace("'den", "'den başlar")
    satir = [('Birim fiyat' if t in ('rulo', 'yazi', 'dtf', 'duvar') else 'Fiyat', bf)]
    if t in ('kartvizit', 'davetiye'):
        p = u['paketler'][0]
        satir.append(('En az sipariş', '%s adet (%s + KDV)' % (p['adet'], tl(min(p['tek'], p['cift'])))))
    else:
        satir.append(('En az sipariş', asgari))
    if t == 'rulo':
        if u.get('max_boy'):
            olcu = 'Tek parça en fazla %s × %s cm' % (u['net_en'], u['max_boy'])
        elif u.get('kesim'):
            olcu = 'Her sticker en az %s cm; en fazla %s adet. Genişlik en fazla %s cm' % (u['kesim']['min_cm'], u['kesim']['max_adet'], u['net_en'])
        else:
            olcu = 'Bir kenar en fazla %s cm, diğer kenar en fazla %s metre' % (u['net_en'], G['tek_parca_max_boy'] // 100)
    elif t == 'yazi':
        olcu = 'Genişlik en fazla %s cm; harf yüksekliği en az %s cm' % (u['max_en'], min(k['min_harf'] for k in u['kademeler']))
    elif t == 'dtf':
        olcu = ('Tek parça en fazla %s × %s cm; en küçük tasarım %s cm' % (u['tabaka']['en'], u['tabaka']['boy'], u['min_cm'])) if u.get('tabaka') else \
               ('Genişlik en fazla %s cm, uzunluk en fazla %s metre; en küçük tasarım %s cm' % (u['rulo_en'], G['tek_parca_max_boy'] // 100, u['min_cm']))
    elif t == 'duvar':
        olcu = 'Duvarınızın ölçüsünde; kenarlar en fazla %s metre' % (G['tek_parca_max_boy'] // 100)
    elif t == 'kartvizit':
        olcu = u.get('olcu', '')
    elif t == 'davetiye':
        o = u['olcu']
        olcu = '%s × %s cm' % (('%g' % (o['en'] / 10)), ('%g' % (o['boy'] / 10)))
    else:
        olcu = ''
    if olcu:
        satir.append(('Ölçü', olcu))
    if u.get('kargo_yok'):
        tes = "1–2 iş gününde hazır; Kadıköy'deki atölyemizden teslim ya da nakliye (kargoyla gönderilmez)"
    elif t == 'davetiye':
        tes = 'Onaydan sonra %s iş gününde kargoda' % u.get('uretim_is_gunu', 3)
    elif t == 'duvar':
        tes = 'Malzeme siparişinize özel alınır; teslim süresi sipariş onayında bildirilir'
    elif t == 'kartvizit':
        tes = std + '; kargo ücretsiz'
    else:
        tes = std
    if u.get('laminasyon') and not u.get('kargo_yok'):
        tes += '. Laminasyonlu işlerde süre sipariş onayında bildirilir'
    satir.append(('Teslim', tes))
    if u.get('malzemeler'):
        satir.append(('Malzeme', ', '.join(m['ad'] for m in u['malzemeler'])))
    elif u.get('kagit'):
        satir.append(('Malzeme', u['kagit']))
    return satir


def kisaca_ekle(s, satir):
    """Kutuyu hesaplayıcının altına, sayfadaki teknik tablonun hemen önüne koyar; sayfanın üst kısmı değişmez."""
    if 'class="spec kisaca"' in s:
        return s
    tablo = '<table class="spec kisaca"><caption>Kısaca</caption><tbody>%s</tbody></table>' % ''.join(
        '<tr><th scope="row">%s</th><td>%s</td></tr>' % (E(a), E(b)) for a, b in satir)
    yer = -1
    c = s.find('class="sp-cerceve"')
    if c >= 0:
        n = s.find('</noscript></div>', c)
        yer = n + len('</noscript></div>') if n >= 0 else -1
    if yer < 0:
        yer = s.find('<table class="spec">')
    if yer < 0:
        h = s.find('</h1>')
        if h < 0:
            return s
        pk = s.find('</p>', h)
        yer = pk + 4 if 0 <= pk < h + 900 else h + 5
    s = s[:yer] + tablo + s[yer:]
    return s.replace('</head>', KISACA_STIL + '</head>', 1)


def urun_semalari():
    F = js('siparis/src/fiyatlar.json')['urunler']
    F_genel = js('siparis/src/fiyatlar.json')['genel']
    C = js('content/fiyatlar.json')
    taban = 'https://www.istanbulprintlab.com'
    for yol, kod in URUN_SEMA.items():
        f = '%s/%s/index.html' % (DIST, yol)
        if not os.path.exists(f):
            continue
        s = open(f, encoding='utf-8').read()
        if kod:
            if kod not in F:
                continue
            r = urun_fiyat_sayi(F[kod])
        elif yol == 'roll-up-baski':
            r = (C.get('rollup'), 'adet', False)
        else:
            r = (C.get('dekupe'), 'adet', True)
        if not r or not r[0]:
            continue
        fiyat, birim, den = r
        h1 = re.search(r'<h1[^>]*>(.*?)</h1>', s, re.S)
        ad = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', h1.group(1))).strip() if h1 else yol
        ac = re.search(r'<meta name="description" content="([^"]*)"', s)
        gr = re.search(r'<meta property="og:image" content="([^"]*)"', s)
        kdv = 1 + F_genel.get('kdv_orani', 0.2)
        fiyat_kdvli = round(fiyat * kdv, 2)
        ps = {'@type': 'UnitPriceSpecification', 'price': '%.2f' % fiyat_kdvli, 'priceCurrency': 'TRY', 'valueAddedTaxIncluded': True}
        if birim in ('MTK', 'MTR'):
            ps['unitCode'] = birim
            ps['unitText'] = 'm²' if birim == 'MTK' else 'metre'
            ps['referenceQuantity'] = {'@type': 'QuantitativeValue', 'value': 1, 'unitCode': birim}
        else:
            ps['unitText'] = birim
        teklif = {'@type': 'Offer', 'url': '%s/%s/' % (taban, yol), 'priceCurrency': 'TRY', 'price': '%.2f' % fiyat_kdvli,
                  'availability': 'https://schema.org/InStock', 'seller': {'@id': taban + '/#isletme'}, 'priceSpecification': ps}
        if kod and birim in ('MTK', 'MTR', 'tabaka'):
            teklif['eligibleTransactionVolume'] = {'@type': 'PriceSpecification', 'minPrice': '%.2f' % round(F_genel['asgari_baski'] * kdv, 2),
                                                   'priceCurrency': 'TRY', 'valueAddedTaxIncluded': True}
        sema = {'@context': 'https://schema.org', '@type': 'Product', 'name': html.unescape(ad), 'brand': {'@type': 'Brand', 'name': 'IstanbulPrintLab'},
                'url': '%s/%s/' % (taban, yol), 'offers': teklif}
        if ac:
            sema['description'] = html.unescape(ac.group(1))
        if gr:
            sema['image'] = gr.group(1)
        # sayfada elle yazılmış (eski fiyatlı) Product bloğu varsa kaldır, güncelini ekle
        s = re.sub(r'<script type="application/ld\+json">\s*\{[^<]*?"@type":\s*"Product"[^<]*?</script>\n?', '', s)
        s = s.replace('</head>', '<script type="application/ld+json">%s</script>\n</head>' % json.dumps(sema, ensure_ascii=False), 1)
        s = kisaca_ekle(s, kisaca_satirlari(yol, kod, F, C, F_genel))
        open(f, 'w', encoding='utf-8').write(s)


def llms_txt():
    """Site köküne yapay zekâ asistanları için tek sayfalık sade özet (fiyatlar her derlemede güncel dosyadan)."""
    F = js('siparis/src/fiyatlar.json')
    C = js('content/fiyatlar.json')
    G = F['genel']
    taban = 'https://www.istanbulprintlab.com'
    def tl(x):
        return ('{:,.0f}'.format(x)).replace(',', '.') + ' TL'
    birimler = {'MTK': 'm²', 'MTR': 'metre', 'tabaka': 'tabaka', 'paket': 'paket', 'adet': 'adet'}
    urunler = []
    for yol, kod in URUN_SEMA.items():
        f = '%s/%s/index.html' % (DIST, yol)
        if not os.path.exists(f):
            continue
        if kod:
            if kod not in F['urunler']:
                continue
            r = urun_fiyat_sayi(F['urunler'][kod])
        elif yol == 'roll-up-baski':
            r = (C.get('rollup'), 'adet', False)
        else:
            r = (C.get('dekupe'), 'adet', True)
        if not r or not r[0]:
            continue
        h1 = re.search(r'<h1[^>]*>(.*?)</h1>', open(f, encoding='utf-8').read(), re.S)
        ad = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', h1.group(1))).strip()) if h1 else yol
        urunler.append('- [%s](%s/%s/): %s + KDV / %s%s' % (ad, taban, yol, tl(r[0]), birimler.get(r[1], r[1]), ' (en düşük fiyat; seçeneğe göre değişir)' if r[2] else ''))
    teklif = []
    for yol, ad in (('pirinc-tabela', 'Pirinç tabela'), ('rulo-etiket-baski', 'Rulo etiket baskı'), ('ofis-cam-filmi', 'Ofis cam filmi ve kumlama folyo'),
                    ('yilbasi-ayakli-fotoblok', 'Yılbaşı ayaklı fotoblok (AVM ve mağazalar)'), ('folyo-kaplama', 'Folyo kaplama'), ('cam-yazisi-uygulama', 'Cam yazısı uygulama')):
        if os.path.exists('%s/%s/index.html' % (DIST, yol)):
            teklif.append('- [%s](%s/%s/)' % (ad, taban, yol))
    metin = '\n'.join([
        '# IstanbulPrintLab',
        '',
        "> İstanbul Kadıköy'de dijital baskı atölyesi. Sticker, etiket, folyo, branda, afiş, poster, foreks, fotoblok, one way vision, duvar kağıdı, kartvizit, davetiye ve DTF baskı yapar. Müşteri sitede ürünü seçer, ölçüsünü yazar, dosyasını yükler; fiyatı anında görür ve kartla öder.",
        '',
        "- Kadıköy, İstanbul'da baskı merkezi. 10 dilde hizmet: Türkçe, İngilizce, Rusça, Arapça, Almanca, Fransızca, İspanyolca, İtalyanca, Urduca, Farsça.",
        '- Türkiye geneline kargo ve dünya geneline gönderim. Siparişler Kadıköy\'deki atölyeden teslim de alınabilir.',
        '',
        '## Nasıl sipariş verilir',
        '- Ürünü seçin, ölçüyü yazın, baskı dosyasını yükleyin. Fiyat anında ekranda görünür.',
        '- Site dosyanın baskıya uygun olup olmadığını hemen söyler. Uygun değilse yeni dosya yüklenir ya da WhatsApp\'tan yardım istenir.',
        '- Ödeme kartla (PayTR, 3D Secure, taksit seçenekli) ya da havale/EFT ile yapılır.',
        "- Standart işler dosya ve ödeme onayından sonra 1–2 iş gününde kargoya verilir. Laminasyonlu işler, davetiye ve büyük işlerde süre ürün sayfasında yazar.",
        '',
        '## Fiyat kuralları',
        '- Ürün fiyatları KDV hariç yazılır; hesaplayıcıda ve ödemede KDV dahil toplam gösterilir.',
        '- En az sipariş tutarı %s + KDV.' % tl(G['asgari_baski']),
        '- Kargo: KDV dahil %s altındaki siparişlerde %s; %s ve üzerinde ücretsiz (%s m²\'ye kadar). Kartvizitte kargo her zaman ücretsiz. Foreks ve fotoblok kargoyla gönderilmez; atölyeden teslim veya nakliye.' % (tl(G['kargo_ucretsiz_esik']), tl(G['kargo_ucreti']), tl(G['kargo_ucretsiz_esik']), G['kargo_max_m2']),
        '- Orijinal GREENGUARD Gold sertifikalı Mimaki mürekkep kullanılır.',
        '',
        '## Ürünler ve başlangıç fiyatları (KDV hariç)',
    ] + urunler + [
        '',
        '## Ölçüye göre teklifle yapılan işler',
    ] + teklif + [
        '',
        '## İletişim',
        "- Atölye: Fikirtepe Mah. Dispanser Sok. No:50/A-B, Kadıköy / İstanbul",
        '- Telefon ve WhatsApp: +90 532 523 73 64',
        '- E-posta: info@istanbulprintlab.com',
        '- Çalışma saatleri: Pazartesi–Cumartesi 09:00–19:00',
        '- Instagram: https://www.instagram.com/istanbulprintlab',
        '- Site: %s/' % taban,
        '',
        '---',
        '',
        '# IstanbulPrintLab (English)',
        '',
        "> A print shop in Kadıköy, Istanbul, Türkiye. We print stickers, labels, printed vinyl, PVC banners, mesh banners, posters, foam boards, rigid display boards, one way vision window film, wallpaper, business cards, invitations and DTF transfers in our own workshop.",
        '',
        '- Service in 10 languages: Turkish, English, Russian, Arabic, German, French, Spanish, Italian, Urdu and Persian. Each language has its own pages: %s/en/, /ru/, /ar/, /de/, /fr/, /es/, /it/, /ur/, /fa/.' % taban,
        '- We ship across Türkiye and worldwide. Orders can also be picked up at our workshop in Kadıköy.',
        '- Standard print jobs ship 1–2 business days after the file and payment are approved. Delivery time abroad depends on the country and the carrier.',
        '',
        '## How to order',
        '- Choose a product, type your size and upload your print file. The price appears right away.',
        '- The site checks whether the file is good enough to print. If it is not, upload a new file or ask us on WhatsApp.',
        '',
        '## How prices work',
        '- Turkish prices on the Turkish pages are shown without VAT (KDV); VAT is added at checkout. Minimum order: %s + VAT.' % tl(G['asgari_baski']),
        '- Orders shipped outside Türkiye: prices are 20% above the Turkish price without VAT, shown in euros and US dollars at the daily rate of the Central Bank of the Republic of Türkiye (TCMB). VAT is added only if it applies.',
        '- International shipping is paid by the buyer. We find the cheapest suitable carrier and tell you the shipping cost before you pay.',
        '- We print with original Mimaki ink certified GREENGUARD Gold.',
        '',
        '## Contact',
        '- Workshop: Fikirtepe Mah. Dispanser Sok. No:50/A-B, Kadıköy / Istanbul, Türkiye',
        '- Phone and WhatsApp: +90 532 523 73 64',
        '- Email: info@istanbulprintlab.com',
        '- Opening hours: Monday–Saturday 09:00–19:00 (GMT+3)',
        '',
    ])
    yaz('%s/llms.txt' % DIST, metin)


def sss_ek_listesi(F, G):
    """Soru-cevabı olmayan sayfalar için rakamla cevap veren sorular (rakamlar fiyat dosyasından)."""
    def tl(x):
        return ('{:,.0f}'.format(x)).replace(',', '.') + ' ₺'
    std = 'Dosya ve ödeme onayından sonra 1–2 iş gününde kargoya verilir.'
    asg = 'En az sipariş tutarı %s + KDV.' % tl(G['asgari_baski'])
    L = {}
    y = F.get('folyo-yazi-kesim')
    if y:
        k = sorted(y['kademeler'], key=lambda x: -x['min_harf'])
        renk = [r['ad'] for r in y.get('renkler', []) if not r.get('teklif')]
        L['folyo-yazi-kesim'] = [
            ('Folyo yazı kesim fiyatı ne kadar?', 'Harfleri %s cm ve üstü olan yazılarda %s + KDV / m², %s–%s cm arası harflerde %s + KDV / m². Aktarma bandı fiyata dahildir. %s %s cm\'den küçük harfler ve el yazısı için bize yazın, size özel fiyat verelim.' % (
                k[0]['min_harf'], tl(k[0]['m2']), k[-1]['min_harf'], k[0]['min_harf'], tl(k[-1]['m2']), asg, k[-1]['min_harf'])),
            ('Hangi renkler var?', '%s. Altın, gümüş ve listede olmayan renkler için bize yazın.' % ', '.join(renk)),
            ('En büyük ne kadar olabilir?', 'Genişlik en fazla %s cm, uzunluk en fazla %s metre.' % (y['max_en'], G['tek_parca_max_boy'] // 100)),
            ('Kaç günde hazır olur?', std)]
    y = F.get('kartvizit-baski')
    if y:
        pk = '\n'.join('%s adet: tek yön %s, çift yön %s' % (p['adet'], tl(p['tek']), tl(p['cift'])) for p in y['paketler'])
        L['kartvizit-baski'] = [
            ('Kartvizit fiyatı ne kadar?', 'Fiyatlar KDV hariçtir; selefon ve kargo dahildir.\n' + pk),
            ('Kendi tasarımımı yükleyebilir miyim?', 'Evet. Tasarımınızı PDF olarak yükleyin; aynı fiyatlarla basılır. Tasarımınız yoksa sitedeki 10 hazır şablondan birini seçip bilgilerinizi yazın.'),
            ('Hangi kağıda basılıyor?', '%s; ölçü %s.' % (y.get('kagit', ''), y.get('olcu', ''))),
            ('Kaç günde elime ulaşır?', std + ' Kargo ücretsizdir.')]
    y = F.get('soguk-dtf-baski')
    if y:
        L['soguk-dtf-baski'] = [
            ('UV DTF baskı fiyatı ne kadar?', '%s cm genişlikte metresi %s + KDV. %s' % (y['rulo_en'], tl(y['metre_fiyat']), asg)),
            ('UV DTF nedir, nereye yapışır?', 'Arka planı olmayan, yalnızca tasarımınızın basıldığı transfer sticker\'dır. Kupa, cam, şişe ve sert yüzeylere yapıştırılır, üstteki taşıyıcı film soyulur.'),
            ('En küçük ve en büyük ölçü nedir?', 'Genişlik en fazla %s cm, uzunluk en fazla %s metre. En küçük tasarım %s cm.' % (y['rulo_en'], G['tek_parca_max_boy'] // 100, y['min_cm'])),
            ('Kaç günde hazır olur?', std)]
    y = F.get('sicak-dtf-baski')
    if y and y.get('tabaka'):
        t = y['tabaka']
        L['sicak-dtf-baski'] = [
            ('Sıcak DTF baskı fiyatı ne kadar?', '%s × %s cm\'lik bir tabaka %s + KDV. %s' % (t['en'], t['boy'], tl(t['fiyat']), asg)),
            ('Nasıl uygulanır?', 'Ev ütüsüyle tişört, sweatshirt ve kumaşa uygulanır; pres makinesi gerekmez.'),
            ('En küçük ve en büyük ölçü nedir?', 'Tek parça en fazla %s × %s cm. En küçük tasarım %s cm.' % (t['en'], t['boy'], y['min_cm'])),
            ('Kaç günde hazır olur?', std)]
    y = F.get('davetiye-baski')
    if y:
        pk = '\n'.join('%s adet: tek yön %s, çift yön %s' % (p['adet'], tl(p['tek']), tl(p['cift'])) for p in y['paketler'])
        o = y['olcu']
        L['davetiye-baski'] = [
            ('Davetiye fiyatı ne kadar?', 'Fiyatlar KDV hariçtir; zarf dahil değildir.\n' + pk),
            ('Davetiye ölçüsü nedir?', '%s × %s cm; yatay ya da dikey kullanılabilir.' % ('%g' % (o['en'] / 10), '%g' % (o['boy'] / 10))),
            ('Kendi tasarımımı yükleyebilir miyim?', 'Evet, PDF olarak yükleyin. Tasarımınız yoksa sitedeki hazır şablonlardan birini seçip bilgilerinizi yazın.'),
            ('Kaç günde hazır olur?', 'Onaydan sonra %s iş gününde kargoya verilir.' % y.get('uretim_is_gunu', 3))]
    L['pirinc-tabela'] = [
        ('Pirinç tabela fiyatı ne kadar?', 'Fiyat ölçüye, yazıya ve logo işçiliğine göre değişir. Ölçüyü ve yazıyı WhatsApp\'tan gönderin, size özel fiyat verelim.'),
        ('Hangi yerler için yapıyorsunuz?', 'Ofis, klinik, hukuk bürosu ve butik mağaza kapıları; isim tabelaları ve "Toplantı Odası" gibi yönlendirme tabelaları.'),
        ('Nerede üretiliyor?', "Kadıköy'deki atölyemizde, ölçünüze göre üretilir.")]
    return L


def sss_ekle():
    F = js('siparis/src/fiyatlar.json')
    for yol, liste in sss_ek_listesi(F['urunler'], F['genel']).items():
        f = '%s/%s/index.html' % (DIST, yol)
        if not os.path.exists(f):
            continue
        s = open(f, encoding='utf-8').read()
        if '"FAQPage"' in s or '</main>' not in s:
            continue
        bolum = '<section class="wrap" style="padding-bottom:96px;max-width:900px"><h2 class="h2" style="margin-bottom:24px">Sık sorulanlar</h2>%s</section>\n' % ''.join(
            '<details><summary>%s<span class="plus" aria-hidden="true">+</span></summary><p>%s</p></details>' % (E(q), E(a).replace('\n', '<br>')) for q, a in liste)
        sema = {'@context': 'https://schema.org', '@type': 'FAQPage', 'inLanguage': 'tr',
                'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a.replace('.\n', '. ').replace('\n', '; ')}} for q, a in liste]}
        s = s.replace('</main>', bolum + '</main>', 1)
        s = s.replace('</head>', '<script type="application/ld+json">%s</script>\n</head>' % json.dumps(sema, ensure_ascii=False), 1)
        open(f, 'w', encoding='utf-8').write(s)


def main():
    shutil.rmtree(DIST, ignore_errors=True)
    shutil.copytree('site', DIST)
    # web-to-print sipariş sayfaları (siparis/): /siparis/<ürün>/ altına derlenir, ürün sayfalarına çerçeveyle gömülür
    import subprocess
    r = subprocess.run([sys.executable, os.path.join('siparis', 'build.py')], env=dict(os.environ, YAYIN='1', CIKTI=os.path.abspath(os.path.join(DIST, 'siparis'))), capture_output=True, text=True)
    if r.returncode != 0:
        raise S.IcerikHatasi('Sipariş sayfaları derlenemedi: %s' % (r.stderr.strip().splitlines() or ['bilinmeyen hata'])[-1])
    # ürün sayfaları
    for f in glob.glob('content/sayfalar/*.json'):
        d = js(f)
        p = '%s/%s/index.html' % (DIST, d['yol'])
        if not os.path.exists(p):
            raise S.IcerikHatasi('Ürün sayfası bulunamadı: /%s/ (%s)' % (d['yol'], f))
        try:
            yaz(p, S.uygula_urun(oku(p), d))
        except S.IcerikHatasi as e:
            raise S.IcerikHatasi('/%s/ sayfası: %s' % (d['yol'], e))
    # anasayfa
    p = '%s/index.html' % DIST
    s = S.uygula_ana(oku(p), js('content/anasayfa.json'))
    s = re.sub(r'<!--PROJELER-->.*?<!--/PROJELER-->', lambda m: '<!--PROJELER-->' + projeler_html() + '<!--/PROJELER-->', s, flags=re.S)
    gk, grefs = galeri()
    s = re.sub(r'<!--GALERI_KARTLARI-->.*?<!--/GALERI_KARTLARI-->', lambda m: '<!--GALERI_KARTLARI-->\n' + gk + '<!--/GALERI_KARTLARI-->', s, flags=re.S)
    s = re.sub(r'<!--REFERANSLAR-->.*?<!--/REFERANSLAR-->', lambda m: '<!--REFERANSLAR-->' + grefs + '<!--/REFERANSLAR-->', s, flags=re.S)
    A = js('content/anasayfa.json')
    for isim, html_ in (('URUN_DUGMELERI', urun_dugmeleri_html(A)), ('ONE_CIKANLAR', one_cikanlar_html(A)), ('NE_YAPIYORUZ', ne_yapiyoruz_html(A)),
                        ('HAKKIMIZDA_KISA', S.m2h(A.get('hakkimizda_kisa') or ''))):
        s = re.sub(r'<!--%s-->.*?<!--/%s-->' % (isim, isim), lambda m, h=html_, i=isim: '<!--%s-->%s<!--/%s-->' % (i, h, i), s, flags=re.S)
    yaz(p, s)
    hesap_seridi()
    ana_gorsel_oncelik()
    vakalar()
    # ek diller (ar, ru, fr, de, ur): /en/ sayfalarından, fiyatlar işlenmeden önce üretilir
    import diller
    if os.environ.get('DIL_CIKAR'):
        diller.cikar(DIST, os.environ['DIL_CIKAR'])
    print('Ek diller, çevirisi eksik metin sayısı:', diller.uret(DIST))
    # fiyat ve iletişim — bütün sayfalara
    P = js('content/fiyatlar.json')
    P.update(siparis_fiyatlari())  # hesaplayıcılardaki fiyatlar tek kaynak: siparis/src/fiyatlar.json
    fiyatlari_dogrula(P)
    fiyat_raporu(P, onceki_fiyatlar())
    cift = iletisim_ciftleri()
    for kok, _, dosyalar in os.walk(DIST):
        if kok.startswith(os.path.join(DIST, 'admin')) or kok.startswith(os.path.join(DIST, 'yonetim')):
            continue
        siparis = kok.startswith(os.path.join(DIST, 'siparis'))
        for f in dosyalar:
            if not f.endswith('.html'):
                continue
            yol = os.path.join(kok, f)
            s = oku(yol)
            s2 = s if siparis else fiyat_isle(s, P, yol)  # sipariş sayfaları fiyatlarını kendi fiyat dosyasından alır
            for a, b in cift:
                s2 = s2.replace(a, b)
            s2 = cerez_ekle(s2)
            if s2 != s:
                yaz(yol, s2)
    yaz('%s/fiyatlar.json' % DIST, json.dumps({k: v for k, v in P.items() if k not in ('buyuk_degisiklik_onay', 'buyuk_onay')}, ensure_ascii=False, indent=2))
    import foto_isle
    foto_isle.isle(DIST, YB.RAPOR)
    # favicon (yeni çerçeveli logo motifi): kendi simgesi olmayan tüm sayfalara eklenir
    FAV = ('<link rel="icon" href="/favicon.ico" sizes="any">'
       '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
           '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">'
           '<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">'
           '<link rel="apple-touch-icon" href="/apple-touch-icon.png">')
    for f in glob.glob('%s/**/*.html' % DIST, recursive=True):
        s = open(f, encoding='utf-8').read()
        if 'rel="icon"' in s or '</head>' not in s:
            continue
        open(f, 'w', encoding='utf-8').write(s.replace('</head>', FAV + '</head>', 1))
    # yönetim uygulaması, değişikliğin sitede yayına girdiğini bu dosyadan anlar
    yaz('%s/yonetim/surum.json' % DIST, json.dumps({'commit': os.environ.get('COMMIT_REF', '')}))
    urun_semalari()
    sss_ekle()
    llms_txt()
    diller.site_haritasi(DIST, diller.baglantilar(DIST))
    diller.guven_ekle(DIST)
    diller.isletme_sema(DIST)
    eksik = ic_baglanti_kontrol()
    if eksik:
        raise S.IcerikHatasi('Sitede kırık iç bağlantı var: %s' % ', '.join(sorted(eksik)[:10]))
    print('Derleme tamam.')


# ---------- Ürün sayfası üst şeridi: başlangıç fiyatı + "Fiyatı hesapla" / WhatsApp (reklamdan gelen mobil ziyaretçi ilk ekranda görsün) ----------
SERIT_CSS = ('<style>.hs{margin-top:16px;display:grid;gap:12px}.hs-fiyat{margin:0;font-size:17px}.hs-fiyat b{font-size:22px;font-weight:600}'
             '.hs-fiyat small{display:block;font-size:14px;color:#5f5f5b;margin-top:2px}'
             '.hs-kalite{margin:0;font-size:14px;line-height:1.45;padding:8px 12px;border-left:3px solid #0B0B0B;background:#F4F4F1}.hs-btn{display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:460px}.hs-btn a{min-height:50px;display:flex;align-items:center;justify-content:center;'
             'border-radius:999px;border:1px solid #0B0B0B;text-decoration:none;font-weight:500;font-size:16px;white-space:nowrap;padding:0 12px;text-align:center}'
             '.hs-btn a.ana{background:#0B0B0B;color:#fff}.hs-btn a.ikinci{background:#fff;color:#0B0B0B}#hesapla{scroll-margin-top:84px}'
             '@media (max-width:900px){.pdp[data-siparisli]{display:flex!important;flex-direction:column}.pdp[data-siparisli]>.conf{display:contents}'
             '.pdp[data-siparisli]>.conf>div:first-child{order:-1;margin-bottom:6px}.pdp[data-siparisli]>.conf>.sp-cerceve{order:1}}</style>')


def ana_gorsel_oncelik():
    # ürün sayfasının ana görseli ilk ekrandadır: tembel yüklenmesin, öncelikli insin (LCP)
    for f in glob.glob('%s/**/index.html' % DIST, recursive=True):
        s = oku(f)
        s2 = re.sub(r'<img class="gal-main[^>]*>', lambda m: m.group(0).replace(' loading="lazy"', '').replace('<img ', '<img fetchpriority="high" ', 1) if 'fetchpriority' not in m.group(0) else m.group(0), s)
        if s2 != s:
            yaz(f, s2)


def hesap_seridi():
    F = js('siparis/src/fiyatlar.json')['urunler']
    for f in glob.glob('%s/*/index.html' % DIST):
        s = oku(f)
        m = re.search(r'<iframe data-sp src="/siparis/([a-z0-9-]+)/', s)
        if not m or 'class="hs"' in s or m.group(1) not in F:
            continue
        u = F[m.group(1)]
        fy = baslangic_fiyati(u).split(' + ', 1)
        fiyat = ('<b>%s</b> + %s' % (E(fy[0]), E(fy[1]))) if len(fy) > 1 else ''
        asgari = '' if u['tur'] == 'davetiye' else 'Asgari sipariş tutarı %s + KDV · Tasarım, montaj ve kargo hariç' % _tl(js('siparis/src/fiyatlar.json')['genel']['asgari_baski'])
        # kalite notu: Mimaki'de basılan ürünlerde mürekkep + malzeme + geçiş; yazı kesimde malzeme
        kalite = {'rulo': 'GREENGUARD Gold sertifikalı orijinal Mimaki mürekkep · birinci sınıf malzeme · 8–10 geçişli yüksek kalite baskı',
                  'duvar': 'GREENGUARD Gold sertifikalı orijinal Mimaki mürekkep · çocuk odası dahil güvenle kullanılabilir · birinci sınıf malzeme',
                  'yazi': 'Birinci sınıf kesim folyosu · transfer bandı dahil'}.get(u['tur'], '')
        wa = 'https://wa.me/905325237364?text=' + urllib.parse.quote('Merhaba, %s için fiyat bilgisi almak istiyorum.' % u['ad'])
        serit = ('<div class="hs">' + ('<p class="hs-fiyat">%s%s</p>' % (fiyat, '<small>%s</small>' % asgari if asgari else '') if fiyat else '')
                 + ('<p class="hs-kalite">%s</p>' % E(kalite) if kalite else '')
                 + '<div class="hs-btn"><a class="ana" href="#hesapla">Fiyatı hesapla</a><a class="ikinci" href="%s" target="_blank" rel="noopener">WhatsApp\'tan sor</a></div></div>' % E(wa))
        # başlık açıklamasının hemen altına
        s2, n = re.subn(r'(<p class="lead"[^>]*>.*?</p>)', lambda mm: mm.group(1) + serit, s, count=1, flags=re.S)
        if not n:
            continue
        s2 = s2.replace('<div class="sp-cerceve">', '<div class="sp-cerceve" id="hesapla">', 1)
        s2 = s2.replace('<a href="#teklif" class="main">Teklif Al</a>', '<a href="#hesapla" class="main">Fiyatı hesapla</a>', 1)
        s2 = s2.replace('</head>', SERIT_CSS + '</head>', 1)
        yaz(f, s2)


SITE = 'https://www.istanbulprintlab.com'

# ---------- Çerez onayı + Google Consent Mode + PostHog (src/cerez_onay.py) ----------
import cerez_onay  # noqa: E402
CEREZ = dict(
    bant=False,  # True yapılırsa sağ alttaki çerez onay bandı geri gelir
    anahtar='ipl_cerez', posthog='phc_sXf3DbVV3R6LBHcQTHi7T4boryXwiLoVidPvEoB3XPY7',  # herkese açık proje anahtarı
    diller=['tr', 'en'], yedek='tr', politika={'tr': '/cerez-politikasi/', 'en': '/en/privacy/', 'ar': '/ar/privacy/', 'ru': '/ru/privacy/', 'fr': '/fr/privacy/', 'de': '/de/privacy/', 'ur': '/ur/privacy/', 'es': '/es/privacy/', 'it': '/it/privacy/', 'fa': '/fa/privacy/'},
    renk=dict(zemin='#FFFFFF', yazi='#0B0B0B', cizgi='#E4E4E0', vurgu='#0B0B0B', vurgu_yazi='#FFFFFF'))
ESKI_IZIN = "gtag('consent','default',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted'});"


def cerez_ekle(s):
    if CEREZ.get('bant', True):
        s = s.replace(ESKI_IZIN + '\n', '').replace(ESKI_IZIN, '')
    return cerez_onay.uygula(s, CEREZ)


def calistir():
    try:
        main()
    except (S.IcerikHatasi, FiyatHatasi) as e:
        print('\nYAYIN DURDURULDU — site değişmedi.\nSebep: %s\n' % e)
        YB.bildir(SITE, False, str(e))
        sys.exit(1)
    except Exception as e:
        YB.bildir(SITE, False, 'Beklenmeyen teknik hata (%s: %s). Bu sizin girdiğiniz içerikten kaynaklanmıyor olabilir; Claude\'a iletin.' % (type(e).__name__, e))
        raise
    YB.bildir(SITE, True)


if __name__ == '__main__':
    calistir()
