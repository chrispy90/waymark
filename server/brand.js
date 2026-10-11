// Product name and tagline: the one place to rename the app. Self-hosters can override with env vars.
module.exports = {
  name: process.env.APP_NAME || 'Waymark',
  tagline: process.env.APP_TAGLINE || 'Stories with a sense of place.',
};
