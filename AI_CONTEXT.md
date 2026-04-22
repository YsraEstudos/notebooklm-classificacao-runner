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
4. Push directly to `main` on GitHub unless the user explicitly asks for a PR.
5. Verify the raw `meta.js` and `user.js` URLs return `200`.

Publication rule:

- Do not open a PR by default for this project.
- If a temporary branch is used during local work, merge or fast-forward it into `main` before publishing.
- Only create a PR when the user explicitly requests one.

Live NotebookLM contract:

- Use the accessible notebook `https://notebooklm.google.com/notebook/03d58f37-56b7-4576-9e34-b6010fc553e9` as the selector reference whenever changing composer, submit, or response-capture logic.
- Do not trust `notebooklm_dom_structure.md` alone for chat-panel behavior; confirm the live DOM with Playwright before publishing selector-sensitive changes.
