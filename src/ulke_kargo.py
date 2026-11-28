"""Yabancı dil ana sayfalarına: ülkelere göre kargo bölümü (tüm diller) ve
İstanbul'u ziyaret edenler için ürün bölümü (EN, RU).
Fiyat veya süre sözü verilmez; kargo ücreti siparişe göre en uygun firmadan sorulup bildirilir."""
import os

# Her dil: (başlık, giriş, [(ülke, metin)...], alt not)
KARGO = {
'en': ('Shipping to your country',
 'We print in our workshop in Kadıköy, Istanbul and send your order abroad in sturdy packaging. Product prices for abroad are shown without Turkish VAT. Shipping is not included: after your order we compare carriers and tell you the shipping price for your address; you pay it separately before we send the parcel. Import duties and taxes in your country may apply and are not included.',
 [('Germany and the EU', 'Türkiye is outside the EU, so EU import VAT and any customs duty are charged when the parcel arrives.'),
  ('United Kingdom', 'UK import VAT and any customs duty may be charged on delivery.'),
  ('UAE and the Gulf', 'Sent by express courier. Local customs duty and VAT may apply on arrival.'),
  ('Russia', 'Not every international courier delivers to Russia at the moment. We check which carriers serve your city and offer you the working options and prices.'),
  ('USA and Canada', 'Sent by express courier. Local customs rules apply; duties may be charged on delivery.'),
  ('Other countries', 'Write to us with your city and postcode; we find a carrier and tell you the price before you pay for shipping.')],
 'Rigid boards (foam board, PVC board) and photo blocks are not sent abroad. In Istanbul you can also pick up your order at our workshop in Kadıköy.'),
'ru': ('Доставка в вашу страну',
 'Мы печатаем в нашей мастерской в Кадыкёе (Стамбул) и отправляем заказ за границу в надёжной упаковке. Цены для заграницы указаны без турецкого НДС. Доставка не входит: после заказа мы сравниваем перевозчиков и сообщаем стоимость доставки до вашего адреса; её оплачивают отдельно до отправки. Таможенные пошлины и налоги вашей страны могут взиматься и в цену не входят.',
 [('Германия и ЕС', 'Турция не входит в ЕС, поэтому импортный НДС ЕС и возможные пошлины взимаются при получении посылки.'),
  ('Великобритания', 'При получении могут взиматься импортный НДС и пошлины Великобритании.'),
  ('ОАЭ и страны Залива', 'Отправляем экспресс-курьером. При получении могут взиматься местные пошлины и НДС.'),
  ('Россия', 'Сейчас не все международные курьеры доставляют в Россию. Мы проверяем, какие перевозчики работают с вашим городом, и предлагаем рабочие варианты и цены.'),
  ('США и Канада', 'Отправляем экспресс-курьером. Действуют местные таможенные правила; при получении могут взиматься пошлины.'),
  ('Другие страны', 'Напишите нам город и индекс — найдём перевозчика и сообщим цену до оплаты доставки.')],
 'Жёсткие панели (пенокартон, ПВХ) и фотоблоки за границу не отправляем. В Стамбуле заказ можно забрать в нашей мастерской в Кадыкёе.'),
'de': ('Versand in Ihr Land',
 'Wir drucken in unserer Werkstatt in Kadıköy, Istanbul, und versenden Ihre Bestellung sicher verpackt ins Ausland. Preise für das Ausland verstehen sich ohne türkische MwSt. Der Versand ist nicht enthalten: Nach Ihrer Bestellung vergleichen wir Versanddienste und nennen Ihnen die Versandkosten für Ihre Adresse; diese zahlen Sie separat vor dem Versand. Einfuhrabgaben und Steuern in Ihrem Land können anfallen und sind nicht enthalten.',
 [('Deutschland und EU', 'Die Türkei gehört nicht zur EU, daher fallen bei Ankunft Einfuhrumsatzsteuer und ggf. Zoll an.'),
  ('Vereinigtes Königreich', 'Bei Zustellung können britische Einfuhrumsatzsteuer und Zoll anfallen.'),
  ('VAE und Golfstaaten', 'Versand per Expresskurier. Bei Ankunft können lokale Zölle und MwSt. anfallen.'),
  ('Russland', 'Derzeit liefern nicht alle internationalen Kuriere nach Russland. Wir prüfen, welche Dienste Ihre Stadt erreichen, und nennen Ihnen Optionen und Preise.'),
  ('USA und Kanada', 'Versand per Expresskurier. Es gelten die lokalen Zollregeln; bei Zustellung können Abgaben anfallen.'),
  ('Andere Länder', 'Schreiben Sie uns Stadt und Postleitzahl; wir finden einen Versanddienst und nennen den Preis, bevor Sie den Versand bezahlen.')],
 'Feste Platten (Schaumplatte, PVC) und Fotoblöcke versenden wir nicht ins Ausland. In Istanbul können Sie Ihre Bestellung auch in unserer Werkstatt in Kadıköy abholen.'),
'fr': ('Livraison dans votre pays',
 'Nous imprimons dans notre atelier à Kadıköy, Istanbul, et expédions votre commande à l’étranger dans un emballage solide. Les prix pour l’étranger sont affichés hors TVA turque. La livraison n’est pas incluse : après votre commande, nous comparons les transporteurs et vous indiquons le prix de livraison pour votre adresse ; vous le réglez à part avant l’envoi. Des droits et taxes d’importation peuvent s’appliquer dans votre pays et ne sont pas inclus.',
 [('Allemagne et UE', 'La Turquie ne fait pas partie de l’UE : la TVA à l’importation et d’éventuels droits de douane sont perçus à l’arrivée.'),
  ('Royaume-Uni', 'La TVA britannique à l’importation et d’éventuels droits peuvent être perçus à la livraison.'),
  ('Émirats et Golfe', 'Envoi par coursier express. Des droits de douane et une TVA locale peuvent s’appliquer à l’arrivée.'),
  ('Russie', 'Tous les transporteurs internationaux ne livrent pas la Russie actuellement. Nous vérifions lesquels desservent votre ville et vous proposons les options et prix disponibles.'),
  ('États-Unis et Canada', 'Envoi par coursier express. Les règles douanières locales s’appliquent ; des droits peuvent être perçus à la livraison.'),
  ('Autres pays', 'Indiquez-nous votre ville et votre code postal ; nous trouvons un transporteur et vous donnons le prix avant le paiement de la livraison.')],
 'Les panneaux rigides (carton mousse, PVC) et les photoblocs ne sont pas expédiés à l’étranger. À Istanbul, vous pouvez aussi retirer votre commande dans notre atelier à Kadıköy.'),
'es': ('Envío a su país',
 'Imprimimos en nuestro taller de Kadıköy, Estambul, y enviamos su pedido al extranjero en un embalaje resistente. Los precios para el extranjero se muestran sin IVA turco. El envío no está incluido: tras su pedido comparamos transportistas y le indicamos el precio de envío a su dirección; lo paga aparte antes del envío. Pueden aplicarse aranceles e impuestos de importación en su país, que no están incluidos.',
 [('Alemania y la UE', 'Turquía no forma parte de la UE, así que el IVA de importación y los posibles aranceles se cobran a la llegada.'),
  ('Reino Unido', 'Pueden cobrarse el IVA de importación británico y aranceles en la entrega.'),
  ('EAU y el Golfo', 'Envío por mensajería urgente. A la llegada pueden aplicarse aranceles e IVA locales.'),
  ('Rusia', 'Actualmente no todos los mensajeros internacionales entregan en Rusia. Comprobamos qué transportistas llegan a su ciudad y le ofrecemos las opciones y precios disponibles.'),
  ('EE. UU. y Canadá', 'Envío por mensajería urgente. Se aplican las normas aduaneras locales; pueden cobrarse aranceles en la entrega.'),
  ('Otros países', 'Escríbanos su ciudad y código postal; buscamos transportista y le damos el precio antes de pagar el envío.')],
 'Los paneles rígidos (cartón pluma, PVC) y los fotobloques no se envían al extranjero. En Estambul también puede recoger su pedido en nuestro taller de Kadıköy.'),
'it': ('Spedizione nel vostro paese',
 'Stampiamo nel nostro laboratorio a Kadıköy, Istanbul, e spediamo l’ordine all’estero in un imballo robusto. I prezzi per l’estero sono indicati senza IVA turca. La spedizione non è inclusa: dopo l’ordine confrontiamo i corrieri e vi comunichiamo il costo di spedizione per il vostro indirizzo; lo pagate a parte prima dell’invio. Nel vostro paese possono essere applicati dazi e tasse di importazione, non inclusi.',
 [('Germania e UE', 'La Turchia non fa parte dell’UE: IVA all’importazione ed eventuali dazi vengono riscossi all’arrivo.'),
  ('Regno Unito', 'Alla consegna possono essere riscossi IVA britannica all’importazione e dazi.'),
  ('Emirati e Golfo', 'Spedizione con corriere espresso. All’arrivo possono applicarsi dazi e IVA locali.'),
  ('Russia', 'Al momento non tutti i corrieri internazionali consegnano in Russia. Verifichiamo quali servono la vostra città e vi proponiamo le opzioni e i prezzi disponibili.'),
  ('USA e Canada', 'Spedizione con corriere espresso. Valgono le regole doganali locali; alla consegna possono essere riscossi dazi.'),
  ('Altri paesi', 'Scriveteci città e CAP; troviamo un corriere e vi diamo il prezzo prima del pagamento della spedizione.')],
 'Pannelli rigidi (forex, PVC) e fotoblocchi non vengono spediti all’estero. A Istanbul potete anche ritirare l’ordine nel nostro laboratorio a Kadıköy.'),
'ar': ('الشحن إلى بلدك',
 'نطبع في ورشتنا في قاضي كوي بإسطنبول ونرسل طلبك إلى الخارج في تغليف متين. أسعار الطلبات إلى الخارج معروضة بدون ضريبة القيمة المضافة التركية. الشحن غير مشمول: بعد طلبك نقارن شركات الشحن ونخبرك بتكلفة الشحن إلى عنوانك، وتدفعها على حدة قبل إرسال الطرد. قد تُطبَّق رسوم جمركية وضرائب في بلدك وهي غير مشمولة.',
 [('ألمانيا والاتحاد الأوروبي', 'تركيا ليست ضمن الاتحاد الأوروبي، لذا تُحصَّل ضريبة الاستيراد وأي رسوم جمركية عند وصول الطرد.'),
  ('المملكة المتحدة', 'قد تُحصَّل ضريبة الاستيراد البريطانية والرسوم الجمركية عند التسليم.'),
  ('الإمارات ودول الخليج', 'نرسل عبر البريد السريع. قد تُطبَّق رسوم جمركية وضريبة قيمة مضافة محلية عند الوصول.'),
  ('روسيا', 'ليست كل شركات البريد السريع الدولية توصل إلى روسيا حاليًا. نتحقق من الشركات التي تخدم مدينتك ونعرض عليك الخيارات المتاحة وأسعارها.'),
  ('الولايات المتحدة وكندا', 'نرسل عبر البريد السريع. تُطبَّق القواعد الجمركية المحلية، وقد تُحصَّل رسوم عند التسليم.'),
  ('دول أخرى', 'اكتب لنا مدينتك والرمز البريدي؛ نجد شركة شحن ونخبرك بالسعر قبل دفع الشحن.')],
 'الألواح الصلبة (الفوم بورد، PVC) والفوتوبلوك لا تُشحن إلى الخارج. في إسطنبول يمكنك أيضًا استلام طلبك من ورشتنا في قاضي كوي.'),
'fa': ('ارسال به کشور شما',
 'ما در کارگاه خود در کادیکوی استانبول چاپ می‌کنیم و سفارش شما را با بسته‌بندی محکم به خارج می‌فرستیم. قیمت‌های خارج از ترکیه بدون مالیات بر ارزش افزوده ترکیه نمایش داده می‌شوند. هزینه ارسال در قیمت نیست: پس از سفارش، شرکت‌های حمل را مقایسه می‌کنیم و هزینه ارسال به نشانی شما را اعلام می‌کنیم؛ آن را پیش از ارسال بسته جداگانه می‌پردازید. ممکن است در کشور شما عوارض گمرکی و مالیات اعمال شود که در قیمت نیست.',
 [('آلمان و اتحادیه اروپا', 'ترکیه عضو اتحادیه اروپا نیست، بنابراین مالیات واردات و عوارض گمرکی احتمالی هنگام رسیدن بسته دریافت می‌شود.'),
  ('بریتانیا', 'ممکن است مالیات واردات و عوارض گمرکی بریتانیا هنگام تحویل دریافت شود.'),
  ('امارات و کشورهای خلیج', 'با پست سریع ارسال می‌شود. ممکن است هنگام رسیدن عوارض گمرکی و مالیات محلی اعمال شود.'),
  ('روسیه', 'در حال حاضر همه شرکت‌های پست سریع بین‌المللی به روسیه ارسال نمی‌کنند. بررسی می‌کنیم کدام شرکت‌ها به شهر شما خدمات می‌دهند و گزینه‌ها و قیمت‌ها را اعلام می‌کنیم.'),
  ('آمریکا و کانادا', 'با پست سریع ارسال می‌شود. مقررات گمرکی محلی اعمال می‌شود و ممکن است هنگام تحویل عوارض دریافت شود.'),
  ('کشورهای دیگر', 'شهر و کد پستی خود را برای ما بنویسید؛ شرکت حمل را پیدا می‌کنیم و پیش از پرداخت هزینه ارسال قیمت را اعلام می‌کنیم.')],
 'صفحه‌های سخت (فوم‌برد، PVC) و فوتوبلوک به خارج ارسال نمی‌شوند. در استانبول می‌توانید سفارش را از کارگاه ما در کادیکوی هم تحویل بگیرید.'),
'ur': ('آپ کے ملک تک ترسیل',
 'ہم استنبول کے علاقے قادی کوئے میں اپنی ورکشاپ میں پرنٹ کرتے ہیں اور آپ کا آرڈر مضبوط پیکنگ میں بیرونِ ملک بھیجتے ہیں۔ بیرونِ ملک کی قیمتیں ترک ٹیکس (KDV) کے بغیر دکھائی جاتی ہیں۔ ترسیل شامل نہیں: آرڈر کے بعد ہم کوریئر کمپنیوں کا موازنہ کر کے آپ کے پتے تک ترسیل کی قیمت بتاتے ہیں؛ یہ پارسل بھیجنے سے پہلے الگ ادا کی جاتی ہے۔ آپ کے ملک میں کسٹم ڈیوٹی اور ٹیکس لاگو ہو سکتے ہیں جو قیمت میں شامل نہیں۔',
 [('جرمنی اور یورپی یونین', 'ترکی یورپی یونین میں شامل نہیں، اس لیے پارسل پہنچنے پر درآمدی ٹیکس اور ممکنہ کسٹم ڈیوٹی لی جاتی ہے۔'),
  ('برطانیہ', 'ترسیل پر برطانوی درآمدی ٹیکس اور کسٹم ڈیوٹی لی جا سکتی ہے۔'),
  ('متحدہ عرب امارات اور خلیج', 'ایکسپریس کوریئر سے بھیجا جاتا ہے۔ پہنچنے پر مقامی کسٹم ڈیوٹی اور ٹیکس لاگو ہو سکتا ہے۔'),
  ('روس', 'اس وقت ہر بین الاقوامی کوریئر روس تک ترسیل نہیں کرتا۔ ہم دیکھتے ہیں کون سی کمپنیاں آپ کے شہر تک جاتی ہیں اور دستیاب اختیارات اور قیمتیں بتاتے ہیں۔'),
  ('امریکہ اور کینیڈا', 'ایکسپریس کوریئر سے بھیجا جاتا ہے۔ مقامی کسٹم قوانین لاگو ہوتے ہیں؛ ترسیل پر ڈیوٹی لی جا سکتی ہے۔'),
  ('دوسرے ممالک', 'اپنا شہر اور پوسٹ کوڈ لکھ بھیجیں؛ ہم کوریئر ڈھونڈ کر ترسیل کی ادائیگی سے پہلے قیمت بتا دیں گے۔')],
 'سخت بورڈ (فوم بورڈ، PVC) اور فوٹو بلاک بیرونِ ملک نہیں بھیجے جاتے۔ استنبول میں آپ اپنا آرڈر قادی کوئے میں ہماری ورکشاپ سے بھی لے سکتے ہیں۔'),
}

# İstanbul'u ziyaret edenler: (başlık, giriş, [(ürün, açıklama, panel)...])
TURIST = {
'en': ('Visiting Istanbul?',
 'Print it while you are here and pick it up at our workshop in Kadıköy, or we ship it to you (for products that can be sent abroad).',
 [('Event posters', 'Posters for concerts, exhibitions, launches and parties.', 'afis-baski'),
  ('Personalised stickers', 'Your own design or logo as stickers, in custom shapes and sizes.', 'sticker-etiket-baski'),
  ('Photo posters', 'Your holiday photos printed as posters to frame at home.', 'poster-baski'),
  ('Invitations', 'Wedding, birthday and event invitations with your own text.', 'davetiye-baski')]),
'ru': ('Вы в Стамбуле?',
 'Закажите печать, пока вы здесь, и заберите в нашей мастерской в Кадыкёе — или мы отправим заказ вам (для товаров, которые можно отправить за границу).',
 [('Афиши мероприятий', 'Афиши для концертов, выставок, презентаций и вечеринок.', 'afis-baski'),
  ('Именные наклейки', 'Ваш дизайн или логотип в виде наклеек нужной формы и размера.', 'sticker-etiket-baski'),
  ('Фотопостеры', 'Фото из поездки в виде постеров, чтобы повесить дома в рамке.', 'poster-baski'),
  ('Приглашения', 'Приглашения на свадьбу, день рождения и мероприятия с вашим текстом.', 'davetiye-baski')]),
}

FIYAT = {'en': 'Get a price', 'ru': 'Узнать цену'}

CSS = ('<style>.uk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-top:24px}'
       '.uk-k{border:1px solid var(--line);border-radius:12px;padding:18px}.uk-k h3{font-size:17px;margin:0 0 6px}'
       '.uk-k p{font-size:15px;margin:0}.uk-k a{display:inline-block;margin-top:10px}.uk-k a.btn{display:inline-flex;align-items:center;justify-content:center}</style>')


def _esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def bolum(dil):
    h, giris, ul, alt = KARGO[dil]
    kart = ''.join('<div class="uk-k"><h3>%s</h3><p class="muted">%s</p></div>' % (_esc(a), _esc(b)) for a, b in ul)
    s = ('<section id="kargo-ulkeler" class="wrap sec" style="padding-bottom:64px"><h2 class="h2">%s</h2>'
         '<p class="muted" style="max-width:820px;margin-top:12px">%s</p><div class="uk-grid">%s</div>'
         '<p class="note" style="margin-top:18px">%s</p></section>') % (_esc(h), _esc(giris), kart, _esc(alt))
    if dil in TURIST:
        th, tg, ur = TURIST[dil]
        kart = ''.join('<div class="uk-k"><h3>%s</h3><p class="muted">%s</p><a class="btn sm" href="/%s/siparis/%s/">%s</a></div>'
                       % (_esc(a), _esc(b), dil, k, FIYAT[dil]) for a, b, k in ur)
        s = ('<section id="istanbul-ziyaret" class="wrap sec" style="padding-bottom:64px"><h2 class="h2">%s</h2>'
             '<p class="muted" style="max-width:820px;margin-top:12px">%s</p><div class="uk-grid">%s</div></section>') % (_esc(th), _esc(tg), kart) + s
    return s


def ekle(dist):
    n = 0
    for dil in KARGO:
        p = os.path.join(dist, dil, 'index.html')
        if not os.path.exists(p):
            continue
        s = open(p, encoding='utf-8').read()
        if 'id="kargo-ulkeler"' in s:
            continue
        hedef = '<section id="projeler"'
        if hedef not in s:
            hedef = '<section class="wrap" id="sss"'
        s = s.replace(hedef, bolum(dil) + hedef, 1)
        s = s.replace('href="/teslimat-ve-kargo/"', 'href="#kargo-ulkeler"')
        s = s.replace('</head>', CSS + '</head>', 1)
        open(p, 'w', encoding='utf-8').write(s)
        n += 1
    return n


# Google Haritalar'daki gerçek yorumlar (28.11.2026 itibarıyla 2 yorum, 5,0). Metinler aynen; yabancı dillerde çeviri olduğu belirtilir.
YORUM_TR = [('Sıla Ç.', 'Hızlı ve güzel işçilik. Her konuda yardımcı olmaya çalışıyorlar, iletişim kurmak çok kolay. Ürünler büyük bir emekle paketlenip teslim ediliyor. Teşekkür ederim :)'),
            ('Abdullah A.', 'Çok güzel baskılar ve zamanında teslim ediyorlar çok beğendim tavsiye ederim')]
HARITA = 'https://maps.google.com/?cid=11540116692720624947'
YORUM = {
'tr': ('Google yorumları', 'Google Haritalar’da 5,0 puan (2 yorum)', None, 'Tüm yorumları Google’da görün'),
'en': ('Google reviews', 'Rated 5.0 on Google Maps (2 reviews)', ['Fast and lovely workmanship. They try to help with everything and they are very easy to talk to. Products are packed with great care. Thank you :)', 'Very nice prints and they deliver on time. I liked it a lot, I recommend them.'], 'See all reviews on Google', 'Translated from Turkish'),
'ru': ('Отзывы в Google', 'Оценка 5,0 на Google Картах (2 отзыва)', ['Быстрая и красивая работа. Стараются помочь во всём, с ними очень легко общаться. Заказ упаковывают с большой заботой. Спасибо :)', 'Очень хорошая печать и сдают вовремя. Мне очень понравилось, рекомендую.'], 'Все отзывы в Google', 'Перевод с турецкого'),
'de': ('Google-Bewertungen', '5,0 Sterne auf Google Maps (2 Bewertungen)', ['Schnelle und schöne Arbeit. Sie helfen bei allem und sind sehr gut erreichbar. Die Produkte werden mit viel Sorgfalt verpackt. Danke :)', 'Sehr schöne Drucke und pünktliche Lieferung. Hat mir sehr gefallen, ich empfehle sie.'], 'Alle Bewertungen bei Google', 'Aus dem Türkischen übersetzt'),
'fr': ('Avis Google', 'Note de 5,0 sur Google Maps (2 avis)', ['Travail rapide et soigné. Ils essaient d’aider en tout et sont très faciles à joindre. Les produits sont emballés avec beaucoup de soin. Merci :)', 'Très belles impressions et livraison à temps. J’ai beaucoup aimé, je recommande.'], 'Voir tous les avis sur Google', 'Traduit du turc'),
'es': ('Reseñas de Google', 'Valoración 5,0 en Google Maps (2 reseñas)', ['Trabajo rápido y bonito. Intentan ayudar en todo y es muy fácil comunicarse con ellos. Los productos se embalan con mucho cuidado. Gracias :)', 'Impresiones muy bonitas y entregan a tiempo. Me gustó mucho, los recomiendo.'], 'Ver todas las reseñas en Google', 'Traducido del turco'),
'it': ('Recensioni Google', 'Valutazione 5,0 su Google Maps (2 recensioni)', ['Lavoro veloce e curato. Cercano di aiutare in tutto ed è facilissimo comunicare con loro. I prodotti sono imballati con grande cura. Grazie :)', 'Stampe molto belle e consegna puntuale. Mi è piaciuto molto, li consiglio.'], 'Vedi tutte le recensioni su Google', 'Tradotto dal turco'),
'ar': ('تقييمات Google', 'تقييم 5.0 على خرائط Google (تقييمان)', ['عمل سريع وجميل. يحاولون المساعدة في كل شيء والتواصل معهم سهل جدًا. تُغلَّف المنتجات بعناية كبيرة. شكرًا :)', 'طباعة جميلة جدًا ويسلّمون في الموعد. أعجبني كثيرًا وأنصح بهم.'], 'كل التقييمات على Google', 'مترجم من التركية'),
'fa': ('نظرات Google', 'امتیاز 5.0 در نقشه Google (2 نظر)', ['کار سریع و زیبا. در همه چیز کمک می‌کنند و ارتباط با آن‌ها بسیار آسان است. محصولات با دقت زیاد بسته‌بندی می‌شوند. ممنون :)', 'چاپ‌های بسیار خوب و تحویل به‌موقع. خیلی پسندیدم، توصیه می‌کنم.'], 'همه نظرات در Google', 'ترجمه از ترکی'),
'ur': ('Google ریویوز', 'Google Maps پر 5.0 ریٹنگ (2 ریویوز)', ['تیز اور خوبصورت کام۔ ہر معاملے میں مدد کی کوشش کرتے ہیں، ان سے بات کرنا بہت آسان ہے۔ مصنوعات بڑی محنت سے پیک کی جاتی ہیں۔ شکریہ :)', 'بہت اچھے پرنٹ اور وقت پر ترسیل۔ بہت پسند آیا، میں سفارش کرتا ہوں۔'], 'تمام ریویوز Google پر دیکھیں', 'ترکی سے ترجمہ'),
}


def yorum_bolum(dil):
    v = YORUM[dil]
    h, alt, metin, link = v[0], v[1], v[2], v[3]
    kart = ''
    for i, (ad, tr) in enumerate(YORUM_TR):
        t = tr if metin is None else metin[i]
        kart += '<div class="uk-k"><p style="font-size:15px">★★★★★</p><p style="margin-top:6px">“%s”</p><p class="muted" style="margin-top:8px;font-size:14px">— <bdi>%s</bdi> · Google</p></div>' % (_esc(t), _esc(ad))
    not_ = '' if metin is None else ' · ' + _esc(v[4])
    return ('<section id="google-yorumlar" class="wrap sec" style="padding-bottom:64px"><h2 class="h2">%s</h2>'
            '<p class="muted" style="margin-top:12px">%s%s</p><div class="uk-grid">%s</div>'
            '<p style="margin-top:16px"><a href="%s" target="_blank" rel="noopener">%s</a></p></section>') % (_esc(h), _esc(alt), not_, kart, HARITA, _esc(link))


def yorum_ekle(dist):
    n = 0
    for dil in YORUM:
        p = os.path.join(dist, 'index.html') if dil == 'tr' else os.path.join(dist, dil, 'index.html')
        if not os.path.exists(p):
            continue
        s = open(p, encoding='utf-8').read()
        if 'id="google-yorumlar"' in s:
            continue
        hedef = '<section class="wrap" id="sss"'
        if hedef not in s:
            continue
        s = s.replace(hedef, yorum_bolum(dil) + hedef, 1)
        if '.uk-grid{' not in s:
            s = s.replace('</head>', CSS + '</head>', 1)
        open(p, 'w', encoding='utf-8').write(s)
        n += 1
    return n
