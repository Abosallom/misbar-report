# ACCESS.md — who can open the Misbar report page, and how you control it

Operator guide for Aziz. Everything here is run from the repo root
(`~/Claude/misbar`) and takes effect only after you commit and push.

Page URL: <https://abosallom.github.io/misbar-report/>

---

## 1. How the gate works now

The page is public HTML, but the *data* is not: `data/kamc-live.enc` is an
encrypted snapshot, and the key that decrypts it lives inside a sealed blob
(`data/access.seal`). Signing in is what releases that blob's payload.

There are two ways to sign in, and both end in exactly the same place:

| Path | What the visitor types | Where the secret lives |
| --- | --- | --- |
| **Per-user account** (normal) | their **username + password** | `data/users.json` — one row per colleague, each row an independent copy of the config sealed under that person's password |
| **Shared passphrase** (legacy fallback) | the single shared phrase | nothing — the phrase itself unseals `data/access.seal` |

Either path releases the same config (Grafana `accessToken` + `dataKey`),
writes it into the browser's settings, and marks the device unlocked
(`localStorage` key `misbar.unlocked.v1`). After that the device stays open
until it is locked or its storage is cleared.

> **ROTATED 2026-07-27 — the old phrase `Misbar1` no longer opens anything.**
> An adversarial review measured the real cost of guessing (~45 tries/sec/core
> against these parameters) and found the shared phrase was the weak link in the
> whole design: `data/access.seal` is a public file that unseals the *same*
> payload as every per-user record, so a short phrase silently capped the
> strength of every account no matter how strong the individual passwords were.
> An attacker would simply ignore the hardened rows and grind that one file.
> The seal now holds a 20-character random secret, and `scripts/make-seal.mjs`
> refuses to seal a weak one (`ALLOW_WEAK_PASSPHRASE=1` for throwaway local
> seals only). **Treat the phrase as break-glass recovery** — keep it in a
> password manager, sign in day to day with your own account.

The shared passphrase **still works and is not going away** — it is the
way in if the accounts file is ever wrong, and it is what existing devices were
unlocked with. It is also an *input* to account creation: the `add` command
below needs it (as the `PASSPHRASE` environment variable) to unseal
`data/access.seal` so it can re-seal that payload under the new user's
password. The flip side: anyone who knows the phrase can sign in with it no
matter what `data/users.json` says — `remove` cannot stop them. See §7 before
relying on per-user revocation.

In the app, the read-only summary of all this is under
**الإعدادات → الوصول والحسابات**: it shows the account signed in on that device
(**الحساب على هذا الجهاز**) and repeats the commands below. It cannot create or
delete accounts — see §6.

### What you will NOT find here: Grafana logins

A colleague's own Grafana username and password **cannot** be used to sign in,
and no future version can change that. `elab.seha.sa` refuses cross-origin
browser requests (CORS), and it geo-blocks non-Saudi IPs. Both were proven
earlier in this project. A Grafana credential typed into this page could never
fetch a single row. The accounts below are accounts **on this page only**; they
release the already-published snapshot. They are unrelated to SEHA/Grafana
identity, and revoking one here does not touch anyone's Grafana access.

---

## 2. Create an account for a colleague

```sh
 PASSPHRASE='the-shared-passphrase' node scripts/make-user.mjs add --user <username>
```

- `PASSPHRASE` is the **legacy shared passphrase** — the same one that opens
  the page. `add` uses it to unseal `data/access.seal` and re-seal the payload
  under the new user's password. It is read from the environment so it never
  appears in the tool's output; the leading space keeps the line out of your
  zsh history when `HIST_IGNORE_SPACE` is on.
- `--user <username>` — short, lowercase, no spaces (e.g. `sara`, `m.alharbi`),
  2–64 characters.
- **You do not choose the password.** The tool generates a 20-character random
  password (~120 bits) and prints it **exactly once**, at the end of the run:

  ```text
  sara : xK7mPq2wNv…
  ```

  Copy it into a password manager before closing the terminal. It is not
  stored anywhere and cannot be recovered — if you lose it, re-run `add` for
  the same username and a fresh one is generated (§5).
- A `--password '…'` flag exists but **avoid it**: it puts the secret in your
  shell history and process list, and the tool **refuses weak passwords**
  outright (short, few character classes, common words, sequences, the
  username itself). That refusal is a feature, not an obstacle — see §7.

Then publish it:

```sh
git add data/users.json && git commit -m "access: add <username>" && git push
```

The account is live once GitHub Pages finishes deploying (about a minute).

## 3. Remove an account

```sh
node scripts/make-user.mjs remove --user <username>
```

No `PASSPHRASE` needed — removal just deletes that user's row; every other
row is independently encrypted and untouched. Then commit and push the same
way. Until that deploy lands, the removed account still works — and if this
person also knows the legacy shared passphrase, `remove` does not lock them
out at all. Both limits are spelled out in §7.

## 4. List the accounts

```sh
node scripts/make-user.mjs list
```

Prints the usernames and the count. It cannot print passwords; they are not
stored in any recoverable form.

## 5. Rotate a password

There is no separate `change` command — **re-running `add` for an existing
username replaces that row**, generating and printing a fresh password:

```sh
 PASSPHRASE='the-shared-passphrase' node scripts/make-user.mjs add --user sara
git add data/users.json && git commit -m "access: rotate sara" && git push
```

The old password stops working as soon as the deploy lands. Rotate whenever a
password may have been seen by anyone else, or on any device loss; when a
colleague *leaves*, use `remove` (§3) instead.

## 6. What to send a new colleague

Three things:

1. the page URL — <https://abosallom.github.io/misbar-report/>
2. their **username**
3. their **password** (the one the tool printed once)

Send them through a channel that is **not this page** and, ideally, not the
same channel twice — e.g. the link by email and the password by WhatsApp or in
person. Tell them plainly:

- the password is for this page only; it is not their SEHA or Grafana password,
  and they must not reuse a work password here;
- they should not forward it — if a second person needs access, ask you for a
  second account, so that revoking one does not disturb the other;
- if the page asks again on another device, that is normal: the unlocked marker
  is per-browser.

The Arabic they will see on the gate is the sign-in form with the two fields;
inside the app the matching screen is **الإعدادات → الوصول والحسابات**, which
shows **الحساب على هذا الجهاز**.

---

## 7. SECURITY LIMITS — read this once, honestly

This is a static site on GitHub Pages. There is no server, and therefore no
server-side authentication. What that costs you:

- **`data/users.json` is public.** It is committed to a public repo and served
  by the same URL as the page. Anyone can download it. Each row holds a random
  per-user salt and the config encrypted with AES-GCM under a key derived from
  that user's password (PBKDF2-SHA256 × 310,000) — no plaintext password, and
  no hash to "crack" as such, but that is still enough to mount an **offline
  brute-force**: an attacker guesses passwords on their own hardware, as fast
  as their hardware allows, and knows a guess is right when the row decrypts.
- **Nothing can rate-limit them.** No lockout, no "too many attempts", no
  alert. There is no server to enforce one. The only thing standing between a
  downloaded file and the data is the cost of guessing.
- **So the password itself is the entire defence.** This is why the tool
  generates long random passwords and refuses weak ones. A memorable password,
  a name, a date, or anything you could type from memory is inadequate here in
  a way it would not be on a normal website.
- **Revocation is not instant.** `remove` edits a file; the file only reaches
  visitors after a commit, a push, and a Pages deploy — roughly a minute at
  best, and longer if you forget to push. A cached copy of the site may keep
  working a little beyond that. Plan revocation as "within the hour", never as
  "immediately".
- **`remove` cannot revoke the shared passphrase.** The legacy phrase (§1) is a
  second, independent door: the page always falls back to trying the password
  field against `data/access.seal`, username or no username. Anyone who ever
  learned the phrase — which includes every colleague onboarded before
  per-user accounts existed — can keep signing in with a blank username after
  their account row is deleted. Nor is changing the phrase alone enough: the
  repo is public, the old seal stays in git history, and the old phrase unseals
  it offline into the same config. To genuinely cut off a phrase-holder, treat
  the config as exposed and do the full rotation in the last bullet — new
  Grafana token, seal rebuilt with `scripts/make-seal.mjs` under a **new
  phrase**, `add` re-run for every remaining user. From that point the new
  phrase is the `PASSPHRASE` that §2 and §5 need.
- **An already-unlocked device stays unlocked.** Sign-in releases the config
  into that browser's local storage. Removing the account stops *new*
  sign-ins; it does not reach back into a browser that already has the config.
  If a device is lost, treat the config as exposed and rotate it (below).
- **Everyone signed in gets the same data.** Accounts control *who may enter*,
  not *who sees what*. There are no per-user permissions.
- **Every row carries its own copy of the config.** If you need to invalidate
  the underlying config itself — not just one person's entry — rotate the
  Grafana token, rebuild the seal with `scripts/make-seal.mjs`, and then
  **re-run `add` for every remaining user** so their rows carry the new
  payload; rows sealed before the rotation still release the old one.

What this design *does* buy you, and why it beats one shared phrase: each
colleague has a credential of their own, and you can see in `list` exactly who
has access today. The headline benefit — revoking one person without telling
everyone else a new secret — is real **only for colleagues who were never
given the shared passphrase**. For anyone who knows the phrase, revocation
means the full rotation above, exactly as it did before per-user accounts
existed; the accounts make sure that group stops growing.

---

## 8. Quick reference

```sh
 PASSPHRASE='…' node scripts/make-user.mjs add --user <name>   # create — prints the password ONCE
 PASSPHRASE='…' node scripts/make-user.mjs add --user <name>   # same name again = rotate password
node scripts/make-user.mjs remove --user <name>                # revoke
node scripts/make-user.mjs list                                # who has access
git add data/users.json && git commit -m "access: …" && git push   # publish
```
