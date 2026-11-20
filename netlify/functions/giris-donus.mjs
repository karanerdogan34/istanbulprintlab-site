// GitHub girişinden dönüş: kodu anahtara çevirir, yalnızca site sahibinin hesabına (sayısal kimlikle) izin verir,
// anahtarı HttpOnly oturum çerezine yazar ve uygulamaya döner. Anahtar adres çubuğuna ya da tarayıcı belleğine hiç yazılmaz.
import { SAHIP_ID, cerezOku, oturumCerezi, oturumKur } from '../lib/ortak.mjs';

const stateSil = 'yonetim_state=; Path=/.netlify/functions/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
function geri(mesaj, ekCerez) {
  const h = new Headers({ Location: '/yonetim/' + (mesaj ? '#hata=' + encodeURIComponent(mesaj) : ''), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  h.append('Set-Cookie', stateSil);
  if (ekCerez) h.append('Set-Cookie', ekCerez);
  return new Response(null, { status: 302, headers: h });
}

export default async (req) => {
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) return geri('Giriş ayarı eksik. Lütfen yöneticinize bildirin.');
  const u = new URL(req.url);
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  const beklenen = cerezOku(req, 'yonetim_state');
  if (!code || !state || !beklenen || beklenen !== state) return geri('Giriş doğrulanamadı, lütfen tekrar deneyin.');

  let j = {};
  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code }),
    });
    j = await r.json();
  } catch (_) { /* aşağıda ele alınır */ }
  if (!j.access_token) return geri('GitHub girişi tamamlanamadı.');

  const r2 = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + j.access_token, 'User-Agent': 'ipl-yonetim', Accept: 'application/vnd.github+json' } }).catch(() => null);
  if (!r2 || !r2.ok) return geri('GitHub hesabı doğrulanamadı.');
  const kim = await r2.json().catch(() => ({}));
  if (String(kim.id) !== SAHIP_ID) return geri('Bu hesap bu siteyi yönetemez.');

  return geri('', oturumCerezi(oturumKur(j)));
};
