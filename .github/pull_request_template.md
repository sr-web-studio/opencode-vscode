## What this changes

<!-- One or two sentences. Link the issue it fixes, if there is one. -->

## Checks

- [ ] `bun run typecheck`
- [ ] `bun run test` and `bun run test:plugin`
- [ ] `bun run build` and `bun run mobile:build`
- [ ] `bun run format:check` (advisory until the one-time reformat lands)
- [ ] `cd apps/mobile/android && ./gradlew testDebugUnitTest` when native code changed
- [ ] No secrets, tokens, personal paths or real server addresses in the diff or logs
- [ ] A `CHANGELOG.md` line when users of the extension will notice the change
