// Entry point: `node server.js` -> http://localhost:5180
// Env: PORT, DATA_DIR (database + uploads), COOKIE_SECURE=1 behind HTTPS, ALLOW_SIGNUP=0 to close sign-ups.
const { server } = require('./server/index.js');

const PORT = +process.env.PORT || 5180;
server.listen(PORT, () => console.log(`StoryMaps on http://localhost:${PORT}`));
