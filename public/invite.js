export function readRoomInvite({ startParam, hash, search }) {
  const fragment = new URLSearchParams(hash.slice(1));
  const query = new URLSearchParams(search);
  return [startParam, fragment.get('tgWebAppStartParam'), query.get('tgWebAppStartParam'), query.get('room')]
    .find(code => typeof code === 'string' && /^[a-f0-9]{32}$/.test(code));
}

export function roomInviteUrl({ bot, shortName, code, guestOrigin }) {
  const handle = bot?.trim().replace(/^@/, '');
  if (handle && /^[a-z0-9_]+bot$/i.test(handle)) {
    const app = shortName?.trim();
    if (app && !/^[a-z0-9_]+$/i.test(app)) return null;
    const url = new URL('https://t.me/'+handle+(app ? '/'+app : ''));
    url.searchParams.set('startapp',code);
    return url.href;
  }
  if (!guestOrigin) return null;
  const url = new URL('/',guestOrigin);
  url.searchParams.set('room',code);
  return url.href;
}
