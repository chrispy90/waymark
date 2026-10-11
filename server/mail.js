// Minimal SMTP client (no dependencies). Supports implicit TLS (port 465), STARTTLS, and plaintext for
// local test inboxes like Mailpit. Without SMTP_HOST, messages are printed to the console instead.
//
// Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
//      SMTP_SECURE = tls | starttls | none   (default: tls on 465, otherwise starttls)
const net = require('net');
const tls = require('tls');
const os = require('os');
const crypto = require('crypto');

const mailConfigured = () => !!process.env.SMTP_HOST;

function reader(socket) {
  let buf = '';
  let lines = [];
  const ready = [];
  const waiting = [];
  const onData = (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) { // last line of a (possibly multi-line) reply
        const reply = { code: +line.slice(0, 3), text: lines.join('\n') };
        lines = [];
        const w = waiting.shift();
        w ? w.resolve(reply) : ready.push(reply);
      }
    }
  };
  const onError = (err) => { while (waiting.length) waiting.shift().reject(err); };
  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', () => onError(new Error('SMTP connection closed')));
  return {
    next: () => (ready.length ? Promise.resolve(ready.shift()) : new Promise((resolve, reject) => waiting.push({ resolve, reject }))),
    detach: () => { socket.off('data', onData); socket.off('error', onError); },
  };
}

const clean = (s) => {
  if (/[\r\n]/.test(String(s))) throw new Error('Invalid header value');
  return String(s);
};

async function sendMail({ to, subject, text }) {
  if (!mailConfigured()) {
    console.log(`\n--- Email (SMTP not configured, printed instead) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---------------------------------------------------\n`);
    return { delivered: false };
  }
  const host = process.env.SMTP_HOST;
  const port = +process.env.SMTP_PORT || 587;
  const mode = process.env.SMTP_SECURE || (port === 465 ? 'tls' : 'starttls');
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) throw new Error('Set SMTP_FROM');
  const addr = (s) => clean(/<([^>]+)>/.exec(s)?.[1] || s);

  let socket = mode === 'tls' ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  socket.setTimeout(20000, () => socket.destroy(new Error('SMTP timeout')));
  let r = reader(socket);
  const cmd = async (line, expect) => {
    if (line != null) socket.write(line + '\r\n');
    const reply = await r.next();
    if (!expect.includes(reply.code)) throw new Error(`SMTP ${reply.code}: ${reply.text.split('\n').pop()}`);
    return reply;
  };

  try {
    await cmd(null, [220]);
    const helo = `EHLO ${os.hostname().replace(/[^\w.-]/g, '') || 'localhost'}`;
    let ehlo = await cmd(helo, [250]);
    if (mode === 'starttls') {
      if (!/STARTTLS/i.test(ehlo.text)) throw new Error('SMTP server does not offer STARTTLS (set SMTP_SECURE=none only for local test servers)');
      await cmd('STARTTLS', [220]);
      r.detach();
      socket = tls.connect({ socket, servername: host });
      r = reader(socket);
      await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
      ehlo = await cmd(helo, [250]);
    }
    if (process.env.SMTP_USER) {
      const token = Buffer.from(`\0${process.env.SMTP_USER}\0${process.env.SMTP_PASS || ''}`).toString('base64');
      await cmd(`AUTH PLAIN ${token}`, [235]);
    }
    await cmd(`MAIL FROM:<${addr(from)}>`, [250]);
    await cmd(`RCPT TO:<${addr(to)}>`, [250, 251]);
    await cmd('DATA', [354]);
    const domain = addr(from).split('@')[1] || 'localhost';
    const message = [
      `From: ${clean(from)}`,
      `To: ${clean(to)}`,
      `Subject: ${clean(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${domain}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..'), // dot-stuffing
    ].join('\r\n');
    await cmd(`${message}\r\n.`, [250]);
    socket.write('QUIT\r\n');
    return { delivered: true };
  } finally {
    socket.end();
  }
}

module.exports = { sendMail, mailConfigured };
