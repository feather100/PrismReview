## Summary

<!-- What does this PR change and why? Link the related issue. -->

## Checklist

- [ ] `pnpm build` passes (turbo build api + web)
- [ ] `pnpm test` / smoke scripts related to the change pass
- [ ] New or changed behavior covered by a verify/smoke script where feasible
- [ ] No secrets, credentials, or personal data committed
- [ ] Documentation (README / docs/) updated if user-facing behavior changes
- [ ] Conventional commit style (`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`)

## Red-line self-check

- [ ] Default `MODEL_PROVIDER=mock` behavior unchanged (real model calls only via env gate)
- [ ] No addition of `bcrypt` or real password hashing (project convention: `mock_password_hash`)
- [ ] No new A2A wiring (expert Agents still coordinate only through the Moderator)
- [ ] Memory stores only distilled profiles, not chat-history raw text
