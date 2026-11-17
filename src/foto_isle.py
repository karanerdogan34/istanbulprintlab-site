# -*- coding: utf-8 -*-
"""Panelden yüklenen fotoğrafları yayında web için hazırlar:
telefonun döndürme bilgisini uygular, en uzun kenarı 2000 px'e indirir, sıkıştırır.
Yalnızca img/yuklenen/ altındaki dosyalara dokunur; eski fotoğraflar değişmez."""
import os

UZUN_KENAR = 2000
ESIK = 450 * 1024  # bundan küçük ve boyutu uygun dosyalara dokunulmaz


def isle(kok, rapor):
    klasor = os.path.join(kok, 'img', 'yuklenen')
    if not os.path.isdir(klasor):
        return
    try:
        from PIL import Image, ImageOps
    except Exception:
        rapor.append('Uyarı: fotoğraf küçültme aracı (Pillow) bulunamadı; fotoğraflar olduğu gibi yayınlandı.')
        return
    for dk, _, fs in os.walk(klasor):
        for f in fs:
            yol = os.path.join(dk, f)
            uz = os.path.splitext(f)[1].lower()
            if uz not in ('.jpg', '.jpeg', '.png', '.webp'):
                continue
            once = os.path.getsize(yol)
            try:
                with Image.open(yol) as im:
                    buyuk = max(im.size) > UZUN_KENAR
                    exif_var = bool(im.getexif().get(0x0112, 1) != 1)
                    if not (buyuk or exif_var or once > ESIK):
                        continue
                    im = ImageOps.exif_transpose(im)
                    if buyuk:
                        im.thumbnail((UZUN_KENAR, UZUN_KENAR), Image.LANCZOS)
                    if uz in ('.jpg', '.jpeg'):
                        im.convert('RGB').save(yol, 'JPEG', quality=82, optimize=True, progressive=True)
                    elif uz == '.webp':
                        im.save(yol, 'WEBP', quality=80, method=6)
                    else:
                        im.save(yol, 'PNG', optimize=True)
            except Exception as e:
                rapor.append('Uyarı: %s işlenemedi (%s); olduğu gibi yayınlandı.' % (f, e))
                continue
            sonra = os.path.getsize(yol)
            rapor.append('Fotoğraf hazırlandı: %s (%.1f MB → %d KB)' % (f, once / 1048576.0, sonra // 1024))
