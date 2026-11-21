// Yönetim uygulaması için dar kapsamlı GitHub aracısı.
// - Yalnızca aynı siteden gelen JSON POST istekleri (Origin denetimi + SameSite=Strict çerez + özel başlık).
// - Yalnızca IPL deposundaki belirli okuma/yazma uçları; silme ve zorla güncelleme yok.
// - GraphQL sorgusu tarayıcıdan alınmaz: sunucu kendi sabit, salt-okuma sorgusunu kurar; tarayıcı yalnızca commit SHA'sı yollar.
import { REPO, OTURUM, cerezOku, coz, oturumSil, oturumCerezi, yenile, json } from '../lib/ortak.mjs';

const ONEK = `/repos/${REPO}/`;
const SHA = /^[0-9a-f]{40}$/;
const HTML_SAYFA = /^site\/((hakkimizda|kurumsal|istanbul(\/[a-z0-9-]+)?|rehber(\/[a-z0-9-]+)?)\/)?index\.html$/;
const YAZILABILIR = /^(site\/img\/yuklenen\/(projeler|urunler|vakalar|anasayfa|sayfalar|galeri)\/[a-z0-9-]+\.jpg|content\/(projeler|anasayfa|fiyatlar|iletisim)\.json|siparis\/src\/fiyatlar\.json|content\/(sayfalar|vakalar|galeri)\/[a-z0-9-]+\.json|site\/((hakkimizda|kurumsal|istanbul(\/[a-z0-9-]+)?|rehber(\/[a-z0-9-]+)?)\/)?index\.html)$/;
const ICERIK_SORGUSU = `query($o:String!,$n:String!,$e1:String!,$e2:String!,$e3:String!,$e4:String!,$e5:String!,$e6:String!,$e7:String!,$e8:String!,$e9:String!,$e10:String!){repository(owner:$o,name:$n){
  i:object(expression:$e6){...on Blob{text oid}}
  hi:object(expression:$e7){...on Tree{entries{name type}}}
  hr:object(expression:$e8){...on Tree{entries{name type}}}
  f:object(expression:$e5){...on Blob{text oid}}
  p:object(expression:$e1){...on Blob{text oid}}
  a:object(expression:$e4){...on Blob{text oid}}
  s:object(expression:$e2){...on Tree{entries{name object{...on Blob{text oid}}}}}
  v:object(expression:$e3){...on Tree{entries{name object{...on Blob{text oid}}}}}
  sf:object(expression:$e10){...on Blob{text oid}}
  g:object(expression:$e9){...on Tree{entries{name object{...on Blob{text oid}}}}}}}`;

function izinli(yontem, yol, govde) {
  if (yol === '/user') return yontem === 'GET';
  if (!yol.startsWith(ONEK) || /[?#%]|\.\./.test(yol)) return false;
  const alt = yol.slice(ONEK.length);
  if (yontem === 'GET') return /^(git\/ref\/heads\/main|git\/commits\/[0-9a-f]{40}|commits\/[0-9a-f]{40}\/status|compare\/[0-9a-f]{40}\.\.\.([0-9a-f]{40}|main))$/.test(alt);
  if (yontem === 'POST' && alt === 'git/blobs') return true;
  if (yontem === 'POST' && alt === 'git/trees') {
    // Yalnızca yüklenen fotoğraflar ve içerik dosyaları yazılabilir.
    const T = govde && govde.tree;
    return !!govde && SHA.test(String(govde.base_tree || '')) && Array.isArray(T) && T.length > 0 && T.length <= 60 &&
      T.every((e) => e && e.mode === '100644' && e.type === 'blob' && YAZILABILIR.test(String(e.path || '')) && !String(e.path).includes('..') &&
        (('sha' in e) ? SHA.test(String(e.sha)) && !('content' in e) : typeof e.content === 'string'));
  }
  if (yontem === 'POST' && alt === 'git/commits') return !!govde && SHA.test(String(govde.tree || '')) && Array.isArray(govde.parents) && govde.parents.length === 1 && SHA.test(String(govde.parents[0]));
  if (yontem === 'PATCH') return alt === 'git/refs/heads/main' && !!govde && govde.force === false && SHA.test(String(govde.sha || ''));
  return false;
}

export default async (req) => {
  const kaynak = req.headers.get('origin');
  const ayniSite = kaynak && kaynak === new URL(req.url).origin;
  if (req.method === 'DELETE') return ayniSite ? json({ tamam: true }, 200, { 'Set-Cookie': oturumSil }) : json({ message: 'İzin yok' }, 403); // çıkış
  if (req.method !== 'POST' || !ayniSite || req.headers.get('x-yonetim') !== '1' || !(req.headers.get('content-type') || '').startsWith('application/json')) return json({ message: 'İzin yok' }, 403);
  const cerez = cerezOku(req, OTURUM);
  let oturum = cerez && coz(cerez);
  if (!oturum) return json({ message: 'Giriş gerekli' }, 401, cerez ? { 'Set-Cookie': oturumSil } : {});
  let yeniCerez = null;
  if (oturum.te && oturum.te - 60000 < Date.now()) {   // erişim anahtarı bitmek üzere: sessizce yenile
    const y = await yenile(oturum);
    if (!y) return json({ message: 'Giriş gerekli' }, 401, { 'Set-Cookie': oturumSil });
    oturum = y; yeniCerez = oturumCerezi(y);
  }
  let istek;
  try { istek = await req.json(); } catch (_) { return json({ message: 'Geçersiz istek' }, 400); }
  const yontem = String(istek.yontem || 'GET').toUpperCase();
  let yol = String(istek.yol || '');
  let govde = istek.govde;
  if (yol === '/icerik') {
    const sha = String((govde && govde.sha) || '');
    if (yontem !== 'POST' || !SHA.test(sha)) return json({ message: 'Geçersiz istek' }, 400);
    const [o, n] = REPO.split('/');
    yol = '/graphql';
    govde = { query: ICERIK_SORGUSU, variables: { o, n, e1: sha + ':content/projeler.json', e2: sha + ':content/sayfalar', e3: sha + ':content/vakalar', e4: sha + ':content/anasayfa.json', e5: sha + ':content/fiyatlar.json', e6: sha + ':content/iletisim.json', e7: sha + ':site/istanbul', e8: sha + ':site/rehber', e9: sha + ':content/galeri', e10: sha + ':siparis/src/fiyatlar.json' } };
  } else if (yol === '/sayfa') {
    // Tek bir düzenlenebilir HTML sayfasını okur (yalnız izin verilen sayfalar).
    const sha = String((govde && govde.sha) || ''); const dosya = String((govde && govde.dosya) || '');
    if (yontem !== 'POST' || !SHA.test(sha) || !HTML_SAYFA.test(dosya)) return json({ message: 'Geçersiz istek' }, 400);
    const [o, n] = REPO.split('/');
    yol = '/graphql';
    govde = { query: 'query($o:String!,$n:String!,$e:String!){repository(owner:$o,name:$n){d:object(expression:$e){...on Blob{text oid}}}}', variables: { o, n, e: sha + ':' + dosya } };
  } else if (!izinli(yontem, yol, govde)) return json({ message: 'Bu işleme izin verilmiyor' }, 403);
  const gonder = () => fetch('https://api.github.com' + yol, {
      method: yontem,
      headers: { Authorization: 'Bearer ' + oturum.t, Accept: 'application/vnd.github+json', 'User-Agent': 'ipl-yonetim', 'X-GitHub-Api-Version': '2022-11-28', ...(govde ? { 'Content-Type': 'application/json' } : {}) },
      body: govde ? JSON.stringify(govde) : undefined,
    });
  let r;
  try {
    r = await gonder();
    if (r.status === 401 && oturum.r && !yeniCerez) {        // beklenmedik bitiş: bir kez yenileyip tekrar dene
      const y = await yenile(oturum);
      if (y) { oturum = y; yeniCerez = oturumCerezi(y); r = await gonder(); }
    }
  } catch (_) { return json({ message: 'GitHub\'a ulaşılamadı' }, 502, yeniCerez ? { 'Set-Cookie': yeniCerez } : {}); }
  const metin = await r.text();
  const cerezBasligi = r.status === 401 ? oturumSil : yeniCerez;
  return new Response(metin || '{}', { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cerezBasligi ? { 'Set-Cookie': cerezBasligi } : {}) } });
};
