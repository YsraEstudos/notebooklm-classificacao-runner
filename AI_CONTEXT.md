# AI Context

When this project is prepared for GitHub, always bump the version number before publishing.

Versioning rules:

- Increase `package.json` version for every GitHub release.
- Rebuild the userscript after the version bump so `dist/*.user.js` and `dist/*.meta.js` stay in sync.
- Use patch bumps for fixes, minor bumps for new features, and major bumps only for breaking changes.
- Never push a code change to GitHub with the old version number still embedded in the userscript metadata.
- Keep `updateURL` and `downloadURL` pointing to the GitHub `main` branch so Tampermonkey can auto-update.

Release checklist:

1. Bump the version.
2. Rebuild.
3. Commit the generated `dist/` files.
4. Push to GitHub.
5. Verify the raw `meta.js` and `user.js` URLs return `200`.
