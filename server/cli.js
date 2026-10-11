// Admin commands that run against the database directly (no server needed).
const readline = require('readline');
const { db } = require('./db');
const auth = require('./auth');

const PORT = +process.env.PORT || 5180;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

function findUser(email) {
  if (!email) throw new Error('Give an email address, e.g. node server.js reset-link you@example.com');
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email.trim());
  if (!user) throw new Error(`No account with email ${email}`);
  return user;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const commands = {
  async 'reset-link'(email) {
    const user = findUser(email);
    console.log(`Reset link for ${user.email} (valid ${auth.RESET_MINUTES} minutes, single use):\n\n  ${APP_URL}/reset.html?token=${auth.createResetToken(user.id)}\n`);
  },
  async 'set-password'(email) {
    const user = findUser(email);
    const pw = await askHidden('New password (min 8 characters): ');
    if (pw.length < 8) throw new Error('Password must be at least 8 characters');
    if ((await askHidden('Repeat it: ')) !== pw) throw new Error('Passwords did not match');
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(pw), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    console.log(`Password updated for ${user.email}. Existing sessions were signed out.`);
  },
  async users() {
    const rows = db.prepare('SELECT email, name, created_at FROM users ORDER BY created_at').all();
    if (!rows.length) console.log('No accounts yet.');
    rows.forEach((u) => console.log(`${u.email}\t${u.name || ''}\t${new Date(u.created_at).toISOString().slice(0, 10)}`));
  },
};

async function run(command, arg) {
  const fn = commands[command];
  if (!fn) {
    console.log('Usage:\n  node server.js                       start the server\n  node server.js users                 list accounts\n  node server.js reset-link <email>    print a password reset link\n  node server.js set-password <email>  set a password from the terminal');
    return command === 'help' || command === '--help' ? 0 : 1;
  }
  await fn(arg);
  return 0;
}

module.exports = { run };
