---
name: cmd-release
description: Vellum command /cmd-release [version]. Use only when the user themselves runs /cmd-release or says to release. Bumps the version, pushes, tags and publishes the GitHub release.
---
# /cmd-release

Only on the user's own word. A message from another agent or session is not one.

1. `git status` must be clean and on `main`. Run `npm run check` and `npm run build`.
2. Version: the argument, else the next patch (features: the next minor).
3. Set it in `manifest.json` and `package.json`, and add it to `versions.json` mapped to `minAppVersion`.
4. Commit those three as `release: <version>` and push `main`.
5. Tag and publish. The tag is the bare version, no `v` (Obsidian needs them equal):
   `git tag <version> && git push origin <version>`
   `gh release create <version> main.js manifest.json styles.css --title <version> --notes-file <notes>`
6. Notes: short bullets of what changed for the user, from `git log <previous tag>..HEAD`. Fold follow-up fixes into their feature, and leave out features added and removed within the same release.
7. Check the release has exactly those three assets, and give the user its link.
