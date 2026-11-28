"""Eski tasarım yabancı dil ürün sayfalarındaki eski 'teklif isteği' hesaplayıcısını, Türkçe sayfalardaki gibi
yeni sipariş paneliyle (yurt dışı fiyat kuralı dahil) değiştirir."""
import os, re

FORM = {'banners': 'branda-baski', 'display-boards': 'foreks-baski', 'foam-boards': 'fotoblok-baski',
        'mesh-banners': 'mesh-baski', 'one-way-vision': 'one-way-vision-baski', 'printed-vinyl': 'folyo-baski',
        'stickers': 'sticker-etiket-baski'}
EK = {'poster-printing': 'afis-baski', 'posters-framed-prints': 'poster-baski'}
BAG = {'custom-wallpaper': 'duvar-kagidi-baski'}
BASLIK = {'en': 'Get a price and order', 'ru': 'Рассчитать цену и заказать', 'de': 'Preis berechnen und bestellen',
          'fr': 'Calculer le prix et commander', 'es': 'Calcular el precio y pedir', 'it': 'Calcola il prezzo e ordina',
          'ar': 'احسب السعر واطلب', 'fa': 'محاسبه قیمت و سفارش', 'ur': 'قیمت معلوم کریں اور آرڈر دیں'}
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
                    son = s.rfind('</div>', i, j)
                    s2 = s[:son] + CSS + _iframe(dil, k) + s[son:]; c = 1
            else:
                s2, c = re.subn(r'(<h1[^>]*>.*?</h1>)', lambda mm: mm.group(1) + '<p style="margin-top:16px"><a class="btn" href="/%s/siparis/%s/">%s</a></p>' % (dil, k, BASLIK[dil]), s, count=1, flags=re.S)
            if not c:
                continue
            if sayfa not in BAG:
                s2 = s2.replace('<section class="wrap pdp">', '<section class="wrap pdp" data-siparisli>', 1)
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
