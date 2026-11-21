# -*- coding: utf-8 -*-
"""IstanbulPrintLab site derlemesi.
Kaynak: site/ (fiyatlar {{anahtar}} işaretli) + content/*.json (yönetim panelinden düzenlenir)
Çıktı: dist/ — Netlify yalnızca dist/ klasörünü yayınlar.
Çalıştırma: python3 build.py
"""
import glob, html, json, os, re, shutil, sys, urllib.request
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
    ('mesh-baski', '/mesh-branda/', 'Mesh baskı'), ('soguk-dtf-baski', '/soguk-dtf-baski/', 'Soğuk DTF'),
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


def urun_dugmeleri_html():
    F = js('siparis/src/fiyatlar.json')['urunler']
    out = []
    for kod, yol, ad in DUGMELER:
        out.append('<a class="pbtn" href="%s"><b>%s</b><small>%s</small></a>' % (yol, E(ad), E(baslangic_fiyati(F[kod]))))
    return '\n' + '\n'.join(out) + '\n'


# ---------- fiyatlar ----------
TOK = re.compile(r'\{\{([a-z0-9_]+)(?:\*([\d.]+))?(\+kdv|:ham)?\}\}')
HER_TOK = re.compile(r'\{\{[^{}]{0,40}\}\}')
KDV_DAHIL = {'takvim', 'takvim_cerceveli', 'takvim_50', 'takvim_100'}
# Her fiyat için makul aralık (TL). Dışında kalan değer derlemeyi durdurur.
ARALIK = {'asgari': (0, 20000), 'kargo_esik': (0, 200000), 'rollup': (500, 50000)}
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
    for k, v in P.items():
        if k in ('buyuk_degisiklik_onay', 'buyuk_onay') or k not in eski or not isinstance(eski.get(k), int):
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
    s = re.sub(r'<!--URUN_DUGMELERI-->.*?<!--/URUN_DUGMELERI-->', lambda m: '<!--URUN_DUGMELERI-->' + urun_dugmeleri_html() + '<!--/URUN_DUGMELERI-->', s, flags=re.S)
    yaz(p, s)
    vakalar()
    # fiyat ve iletişim — bütün sayfalara
    P = js('content/fiyatlar.json')
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
    # yönetim uygulaması, değişikliğin sitede yayına girdiğini bu dosyadan anlar
    yaz('%s/yonetim/surum.json' % DIST, json.dumps({'commit': os.environ.get('COMMIT_REF', '')}))
    eksik = ic_baglanti_kontrol()
    if eksik:
        raise S.IcerikHatasi('Sitede kırık iç bağlantı var: %s' % ', '.join(sorted(eksik)[:10]))
    print('Derleme tamam.')


SITE = 'https://www.istanbulprintlab.com'

# ---------- Çerez onayı + Google Consent Mode + PostHog (src/cerez_onay.py) ----------
import cerez_onay  # noqa: E402
CEREZ = dict(
    bant=False,  # True yapılırsa sağ alttaki çerez onay bandı geri gelir
    anahtar='ipl_cerez', posthog='phc_sXf3DbVV3R6LBHcQTHi7T4boryXwiLoVidPvEoB3XPY7',  # herkese açık proje anahtarı
    diller=['tr', 'en'], yedek='tr', politika={'tr': '/cerez-politikasi/', 'en': '/en/privacy/'},
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
