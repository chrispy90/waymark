# Security policy

## Reporting a vulnerability

**Please don't report security problems in a public issue.**

Use GitHub's private reporting instead: open the repository's **Security** tab and click **Report a vulnerability**. Only the maintainers can see the report.

Please include:

- what an attacker could do, for example read someone else's draft, run a script in a published story, or sign in as another user;
- the steps to reproduce it, or a story file that triggers it;
- the Waymark version or commit, and how it was deployed (Node, Docker, behind a proxy, exported site).

You should hear back within a week. Once a fix is released, you'll be credited in the changelog unless you'd rather not be.

## Supported versions

Security fixes go into the latest release only. If you host Waymark for other people, keep up with new releases.

## What's in scope

- The Waymark server and web app in this repository.
- Websites created with **Export as a website**.

Problems in MapLibre, Turf, basemap providers or the public data sources should go to those projects. Problems that only happen when Waymark is set up against the advice in the README (for example, running over plain HTTP on the internet, or without `COOKIE_SECURE=1` behind HTTPS) aren't treated as vulnerabilities.

## How Waymark protects you

Sharing is checked on the server for every request: each story, map, layer and dashboard has one owner, and other people only reach it through a share (as a viewer or an editor), a group they belong to, a public link, or a shared story or map that uses it. An item that isn't shared with you answers "not found", the same as one that doesn't exist.

Two features fetch addresses that a signed-in person types in: scheduled layer refresh and reading a map service's description. Both refuse anything but http and https, refuse private, loopback and link-local addresses (unless `ALLOW_PRIVATE_FETCH=1`), re-check every redirect, and cap the response size. The address is resolved before the request is made, so a hostile DNS server that changes its answer between the two could still get through; keep sign-ups closed (`ALLOW_SIGNUP=0`) on a server that sits inside a sensitive network.

Public forms accept submissions from anyone with the link. They are rate-limited per address, checked against the form's questions, and can only add points to their own layer; they never reveal the layer's existing data. Close a form to stop submissions.

The README's [Security section](README.md#-under-the-hood) describes the protections that are built in: password hashing, sessions, CSRF protection, HTML sanitizing, the Content-Security-Policy and upload checks.
