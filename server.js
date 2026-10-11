#!/usr/bin/env node
// Waymark entry point.
//   node server.js                       start the server
//   node server.js reset-link <email>    print a password reset link for an account
//   node server.js set-password <email>  set a new password from the terminal
// Settings come from environment variables or a .env file (see .env.example).
const fs = require('fs');
const http = require('http');
const path = require('path');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Waymark needs Node.js 22.13 or newer (for the built-in SQLite module). You have ${process.version}.\nGet a current version from https://nodejs.org`);
  process.exit(1);
}

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
process.removeAllListeners('warning'); // hide the "SQLite is experimental" notice
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w); });

const brand = require('./server/brand.js');
const [command, ...args] = process.argv.slice(2);
if (command) {
  require('./server/cli.js').run(command, ...args).then((code) => process.exit(code ?? 0), (err) => { console.error(err.message); process.exit(1); });
} else {
  const { server, mailConfigured, APP_URL } = require('./server/index.js');
  const { DATA_DIR } = require('./server/db.js');
  const PORT = +process.env.PORT || 5180;
  // Default: this computer only, on both IPv4 and IPv6 loopback (browsers may resolve "localhost" to either).
  // Set HOST=0.0.0.0 (or ::) to accept connections from other devices.
  const HOST = process.env.HOST || '127.0.0.1';
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Stop the other process or set PORT to a different number.` : err.message);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    if (!process.env.HOST) {
      const v6 = http.createServer(server.listeners('request')[0]);
      v6.on('error', () => {}); // no IPv6 on this machine: IPv4 alone is fine
      v6.listen(PORT, '::1');
    }
    console.log(`\n  ${brand.name} is running at http://localhost:${PORT}\n`);
    console.log(`  Data:   ${DATA_DIR}`);
    console.log(`  Links:  ${APP_URL}`);
    console.log(`  Email:  ${mailConfigured() ? `SMTP via ${process.env.SMTP_HOST}` : 'not configured (password reset links print here)'}\n`);
  });
}
