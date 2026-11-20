// Yönetim uygulaması için dar kapsamlı GitHub aracısı. Yalnızca IPL deposuna ve okuma amaçlı GraphQL sorgularına izin verir;
// silme, zorla güncelleme ve başka depolar engellenir. Anahtar çerezden okunur, tarayıcıya hiç verilmez.
import { REPO, OTURUM, cerezOku, oturumSil, json } from '../lib/ortak.mjs';

const ONEK = `/repos/${REPO}/`;
function izinli(yontem, yol, govde) {
  if (yol === '/user' && yontem === 'GET') return true;
  if (yol === '/graphql' && yontem === 'POST') {
    const q = String((govde && govde.query) || '');
    return !/\bmutation\b|\bsubscription\b/i.test(q) && /repository\(owner:\$o,name:\$n\)/.test(q.replace(/\s/g, '')) && govde.variables && `${govde.variables.o}/${govde.variables.n}` === REPO;
  }
  if (!yol.startsWith(ONEK) || /[?#]|\.\./.test(yol)) return false;
  const alt = yol.slice(ONEK.length);
  if (yontem === 'GET') return /^(git\/ref\/heads\/main|git\/commits\/[0-9a-f]{40}|commits\/[0-9a-f]{40}\/status|compare\/[0-9a-f]{40}\.\.\.[0-9a-f]{40}|compare\/[0-9a-f]{40}\.\.\.main)$/.test(alt);
  if (yontem === 'POST') return /^git\/(blobs|trees|commits)$/.test(alt);
  if (yontem === 'PATCH') return alt === 'git/refs/heads/main' && govde && govde.force === false;
  return false;
}

export default async (req) => {
  if (req.method === 'DELETE') return json({ tamam: true }, 200, { 'Set-Cookie': oturumSil }); // çıkış
  if (req.method !== 'POST' || req.headers.get('x-yonetim') !== '1') return json({ message: 'İzin yok' }, 403);
  const anahtar = cerezOku(req, OTURUM);
  if (!anahtar) return json({ message: 'Giriş gerekli' }, 401);
  let istek;
  try { istek = await req.json(); } catch (_) { return json({ message: 'Geçersiz istek' }, 400); }
  const yontem = String(istek.yontem || 'GET').toUpperCase();
  const yol = String(istek.yol || '');
  if (!izinli(yontem, yol, istek.govde)) return json({ message: 'Bu işleme izin verilmiyor' }, 403);
  let r;
  try {
    r = await fetch('https://api.github.com' + yol, {
      method: yontem,
      headers: { Authorization: 'Bearer ' + anahtar, Accept: 'application/vnd.github+json', 'User-Agent': 'ipl-yonetim', 'X-GitHub-Api-Version': '2022-11-28', ...(istek.govde ? { 'Content-Type': 'application/json' } : {}) },
      body: istek.govde ? JSON.stringify(istek.govde) : undefined,
    });
  } catch (_) { return json({ message: 'GitHub\'a ulaşılamadı' }, 502); }
  const metin = await r.text();
  const ek = r.status === 401 ? { 'Set-Cookie': oturumSil } : {};
  return new Response(metin || '{}', { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...ek } });
};
