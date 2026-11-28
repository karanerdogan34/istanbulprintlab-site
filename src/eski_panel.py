"""Eski tasarım yabancı dil ürün sayfalarındaki eski 'teklif isteği' hesaplayıcısını, Türkçe sayfalardaki gibi
yeni sipariş paneliyle (yurt dışı fiyat kuralı dahil) değiştirir."""
import glob, os, re

FORM = {'banners': 'branda-baski', 'display-boards': 'foreks-baski', 'foam-boards': 'fotoblok-baski',
        'mesh-banners': 'mesh-baski', 'one-way-vision': 'one-way-vision-baski', 'printed-vinyl': 'folyo-baski',
        'stickers': 'sticker-etiket-baski'}
EK = {'poster-printing': 'afis-baski', 'posters-framed-prints': 'poster-baski'}
BAG = {'custom-wallpaper': 'duvar-kagidi-baski'}
BASLIK = {'en': 'Get a price and order', 'ru': 'Рассчитать цену и заказать', 'de': 'Preis berechnen und bestellen',
          'fr': 'Calculer le prix et commander', 'es': 'Calcular el precio y pedir', 'it': 'Calcola il prezzo e ordina',
          'ar': 'احسب السعر واطلب', 'fa': 'محاسبه قیمت و سفارش', 'ur': 'قیمت معلوم کریں اور آرڈر دیں'}
YENI_MADDE = {'en': 'We check your file before printing — nothing is produced without your approval',
 'ru': 'Проверяем файл перед печатью — без вашего подтверждения ничего не производим',
 'ar': 'نفحص ملفك قبل الطباعة — لا نبدأ الإنتاج دون موافقتك',
 'de': 'Wir prüfen Ihre Datei vor dem Druck – ohne Ihre Freigabe wird nichts produziert',
 'fr': 'Nous vérifions votre fichier avant impression — rien n’est produit sans votre accord',
 'es': 'Revisamos su archivo antes de imprimir: no se produce nada sin su aprobación',
 'it': 'Controlliamo il file prima della stampa: nulla viene prodotto senza la vostra approvazione',
 'ur': 'پرنٹ سے پہلے آپ کی فائل چیک کرتے ہیں — آپ کی منظوری کے بغیر کچھ تیار نہیں ہوتا',
 'fa': 'فایل شما را پیش از چاپ بررسی می‌کنیم — بدون تأیید شما چیزی تولید نمی‌شود'}
_K = 'Numbered quote and digital proof — nothing is produced without your approval'
try:
    import json as _j
    ESKI_MADDE = {d: (_K if d == 'en' else _j.load(open('ceviri/%s.json' % d, encoding='utf-8')).get(_K, _K)) for d in YENI_MADDE}
except Exception:
    ESKI_MADDE = {'en': _K}
# eski İspanyolca/İtalyanca masaüstü menüsü iki satıra düşmesin
MENU_CSS = '<style>@media (min-width:901px){html[lang^=es] header .nav a,html[lang^=it] header .nav a,html[lang^=de] header .nav a{white-space:nowrap;font-size:14px}header.site .btn.sm{white-space:nowrap}}</style>'

CSS = ('<style>.pdp[data-siparisli]{grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr)}@media (max-width:900px){.pdp[data-siparisli]{grid-template-columns:1fr}}'
       '.sp-cerceve{margin-top:22px}.sp-cerceve iframe{width:100%;border:0;display:block;height:900px;background:transparent}</style>')


def _iframe(dil, k):
    return ('<div class="sp-cerceve" id="hesapla"><iframe data-sp src="/%s/siparis/%s/?gomulu=1" title="%s"></iframe>'
            '<noscript><p><a class="btn" href="/%s/siparis/%s/">%s</a></p></noscript></div>') % (dil, k, BASLIK[dil], dil, k, BASLIK[dil])


def uygula(dist, diller):
    tr = open(os.path.join(dist, 'sticker-baski', 'index.html'), encoding='utf-8').read() if os.path.exists(os.path.join(dist, 'sticker-baski', 'index.html')) else ''
    m = re.search(r"<script>\(function\(\)\{var fs=function\(\)\{return document\.querySelectorAll\('iframe\[data-sp\]'\)\}.*?</script>", tr, re.S)
    betik = m.group(0) if m else ''
    n = 0
    for dil in diller:
        for sayfa, k in list(FORM.items()) + list(EK.items()) + list(BAG.items()):
            p = os.path.join(dist, dil, sayfa, 'index.html')
            if not os.path.exists(p):
                continue
            s = open(p, encoding='utf-8').read()
            if 'iframe data-sp' in s or ('/%s/siparis/%s/' % (dil, k)) in s and sayfa in BAG:
                continue
            if sayfa in FORM:
                s2, c = re.subn(r'<form class="conf mcalc"[^>]*>\s*(<div>.*?</div>).*?</form>',
                                lambda mm: '<div class="conf">' + mm.group(1) + CSS + _iframe(dil, k) + '</div>', s, count=1, flags=re.S)
            elif sayfa in EK:
                i = s.find('<div class="conf">'); j = s.find('</section>', i)
                c = 0
                if i > 0 and j > 0:
                    blok = s[i:j]
                    blok = re.sub(r'<table class="spec">.*?</table>\s*', '', blok, count=1, flags=re.S)
                    blok2 = re.sub(r'<div class="row"><a class="btn" href="/[a-z]{2}/#en-quote".*?</div>\s*(<p class="note">.*?</p>\s*)*', '', blok, count=1, flags=re.S)
                    s = s[:i] + blok2 + s[j:]; j = s.find('</section>', i)
                    son = s.rfind('</div>', i, j)
                    s2 = s[:son] + CSS + _iframe(dil, k) + s[son:]; c = 1
            else:
                s2, c = re.subn(r'(<h1[^>]*>.*?</h1>)', lambda mm: mm.group(1) + '<p style="margin-top:16px"><a class="btn" href="/%s/siparis/%s/">%s</a></p>' % (dil, k, BASLIK[dil]), s, count=1, flags=re.S)
            if not c:
                continue
            if sayfa not in BAG:
                s2 = s2.replace(ESKI_MADDE.get(dil, '§'), YENI_MADDE[dil])
                s2 = s2.replace('<section class="wrap pdp">', '<section class="wrap pdp" data-siparisli>', 1)
                if MENU_CSS not in s2:
                    s2 = s2.replace('</head>', MENU_CSS + '</head>', 1)
                if betik and betik not in s2:
                    s2 = s2.replace('</body>', betik + '</body>', 1)
            open(p, 'w', encoding='utf-8').write(s2); n += 1
    # eski sayfalardaki TR biçimli tutarı dile göre yaz
    bic = {'en': '1,199', 'ar': '1,199', 'ur': '1,199', 'fa': '1,199', 'ru': '1 199', 'fr': '1 199'}
    for dil, yeni in bic.items():
        p = os.path.join(dist, dil, 'standing-cutouts', 'index.html')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            t2 = t.replace('<b>1.199 TRY</b>', '<b>%s TRY</b>' % yeni)
            if t2 != t:
                open(p, 'w', encoding='utf-8').write(t2)
    return n


LRI, PDI = '\u2066', '\u2069'
ARALIK = re.compile(r'(?<![\d\u2066])(\d+(?:[.,]\d+)?)(\s*[–×]\s*)(\d+(?:[.,]\d+)?)(?![\d\u2069])')


def rtl_sayilar(dist, diller=('ar', 'fa', 'ur')):
    """Sağdan sola dillerde '1–2', '150 × 300' gibi aralıkların ters görünmemesi için soldan sağa yalıtım işareti ekler."""
    n = 0
    for dil in diller:
        for f in glob.glob(os.path.join(dist, dil, '**', '*.html'), recursive=True) + glob.glob(os.path.join(dist, dil, '**', '*.js'), recursive=True):
            s = open(f, encoding='utf-8').read()
            parca = re.split(r'(<script type="application/ld\+json">.*?</script>|<head>.*?</head>)', s, flags=re.S)
            for i in range(0, len(parca), 2):
                parca[i] = ARALIK.sub(lambda m: LRI + m.group(1) + m.group(2) + m.group(3) + PDI, parca[i])
            s2 = ''.join(parca)
            if s2 != s:
                open(f, 'w', encoding='utf-8').write(s2); n += 1
    return n
