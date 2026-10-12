# Contributing to Waymark

Thanks for helping. Bug reports, ideas, docs fixes and code are all welcome.

## Found a bug or have an idea?

[Open an issue](https://github.com/chrispy90/waymark/issues/new/choose) and pick **Bug report** or **Feature request**. For a bug, say what you did, what you expected and what happened. Include your browser and Node version. A link to a public story, or the story's JSON (**⋯ → Download story file** in the editor), helps a lot.

**Security problems go somewhere else.** Please don't open a public issue. See [SECURITY.md](SECURITY.md).

## Working on the code

You need Node.js 22.13 or newer. There's nothing to install.

```bash
git clone https://github.com/chrispy90/waymark.git
cd waymark
npm run dev        # restarts when you edit server code
npm test           # runs the test suite against a temporary database
```

Open http://localhost:5180. Browser code in `public/` is served as-is, so you only need to reload the page. The [README](README.md#-under-the-hood) has a map of the project, and [docs/SCHEMA.md](docs/SCHEMA.md) describes the story format.

## Ground rules

These keep Waymark simple to run and safe to use.

- **No dependencies and no build step.** The server uses only Node's built-in modules, and the browser code is plain ES modules. If a feature truly needs a library, open an issue first so we can talk it through. Browser libraries load from a CDN with an exact version, the way MapLibre and Turf do now.
- **No Esri code.** Waymark is a clean-room project. Don't copy code, styles, icons or text from ArcGIS StoryMaps or any other closed-source product. Open-source code is fine if its license is compatible with MIT, as long as you credit it.
- **No keys or accounts.** Built-in data sources and basemaps must work without an API key, and must allow cross-origin requests from the browser.
- **Old stories must keep working.** If you change the story format, add a conversion to `public/js/story-format.js` and a test in `test/format.test.js`.
- **Story content is untrusted.** Anything that ends up as HTML goes through `public/js/sanitize.js`. Don't add inline scripts, because the Content-Security-Policy blocks them.
- **Respect reduced motion.** New scroll effects must turn off for readers whose device asks for reduced motion.
- **Match the code around you.** Same naming, comment style and formatting. Short comments that explain *why* beat comments that explain *what*.

## Before you open a pull request

1. Run `npm test`, and add a test if you changed the API or the story format.
2. Try your change in the editor and in a published story, on a desktop-sized window and a phone-sized one.
3. If you touched the export, export a story (`node server.js export <slug>`) and open it from a plain web server.
4. Keep each pull request to one change, and describe what it does and how you tested it. Screenshots or a short GIF help for anything visual.
5. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).

By contributing, you agree that your work is released under the project's [MIT License](LICENSE).
