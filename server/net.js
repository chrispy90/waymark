// Fetching other people's URLs from the server (scheduled layer refresh, service descriptions) without letting
// a signed-in user reach this machine's own network: only http(s), only public addresses, redirects re-checked.
const dns = require('dns');
const net = require('net');

const ALLOW_PRIVATE = () => process.env.ALLOW_PRIVATE_FETCH === '1'; // for intranet data sources (and tests)

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::1' || v === '::' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

async function assertPublic(hostname) {
  if (ALLOW_PRIVATE()) return;
  const host = hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.promises.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('That address could not be found');
  if (addrs.some((a) => isPrivate(a.address))) throw new Error('That address is on a private network');
}

/** GETs a public URL. Returns { status, type, body: Buffer }. Throws on private addresses, timeouts and bodies over maxBytes. */
async function safeFetch(url, { maxBytes = 8 * 1024 * 1024, timeout = 20000, accept = '*/*' } = {}) {
  let u = new URL(String(url));
  let res;
  for (let hop = 0; ; hop++) {
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https addresses work');
    await assertPublic(u.hostname);
    res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'Waymark', Accept: accept } });
    const next = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!next) break;
    if (hop >= 4) throw new Error('Too many redirects');
    u = new URL(next, u);
  }
  const chunks = [];
  let size = 0;
  if (res.body) {
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error(`That file is larger than ${Math.round(maxBytes / 1048576)} MB`);
      chunks.push(chunk);
    }
  }
  return { status: res.status, type: res.headers.get('content-type') || '', body: Buffer.concat(chunks), url: u.href };
}

module.exports = { safeFetch, isPrivate };
