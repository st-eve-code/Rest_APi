# Security notes — JWT authentication

Short version of what was added, why each decision was made, and what is still
missing. Written after implementing the system, so it describes the code as it
actually is (`src/features/auth/`, `src/middleware/authenticate.ts`).

---

## 1. What is protected

| Route | Auth | Why |
|---|---|---|
| `GET /health` | public | Load balancers have no credentials. Exposes uptime only. |
| `POST /api/auth/register` | public | It is the sign-up endpoint. |
| `POST /api/auth/login` | public | It is the sign-in endpoint. |
| `POST /api/auth/refresh` | public | Verified by the refresh token itself, not an access token. |
| `POST /api/auth/logout` | public | See §7 — requiring a token to end a session is a trap. |
| `POST /api/auth/logout-all` | access token | Revokes every session for the caller. |
| `GET /api/auth/me` | access token | Otherwise anyone could read anyone's details. |
| `GET`/`POST`/`PATCH /api/items` | access token | Reading and writing the data. |
| **`DELETE /api/items/:id`** | **access token + `admin`** | The only irreversible operation in the API. |

Protection lives in `items.routes.ts` as a single line:

```ts
router.use(authenticate);   // before every route
```

rather than `app.use('/api/items', authenticate, itemsRouter)` in `app.ts`, and
rather than per-route middleware. Reason: a route added to that router later is
then private automatically. Making a route public has to be a deliberate edit;
forgetting to protect one is the failure that matters.

---

## 1a. Why delete is admin-only

Every signed-in user can read, create and update, but only an `admin` can destroy:

```ts
router.delete('/:id', requireRole('admin'), controller.remove);
```

**Order matters and is easy to get backwards.** `authenticate` must come first,
because `requireRole` reads the identity that `authenticate` attached to the
request. Reversed, it finds `undefined` and rejects everyone — including real
admins, which looks like a broken role check rather than a mounting mistake.

**401 vs 403.** No token → `401`. Valid token, wrong role → `403`. The
distinction is not cosmetic: a `401` tells the client "get a new token and retry",
so sending `403` for a permission failure produces an infinite re-authentication
loop against a problem re-authenticating cannot fix. The `403` message also
deliberately does not name the role that was required, so the error cannot be used
to enumerate what roles exist.

**Refusing must not have side effects.** The test suite asserts the item still
exists after the `403` — a permission check that runs *after* the delete has
already happened is not a permission check.

**Admin is granted by the CLI, never by the API.** `POST /api/auth/register`
always creates a `user`, and there is no endpoint that can promote anybody:

```bash
npm run db:make-admin -- you@example.com
```

Any HTTP route able to grant admin is a privilege-escalation hole: if it is
reachable, a bug — or a stolen token — anywhere else becomes a full account
takeover. Requiring database (i.e. server) access for role changes keeps that
class of bug out of reach entirely, and leaves the change visible in the
database's own audit trail.

**Sign in again after promoting.** The role is a claim inside the access token,
so a token issued before the promotion still says `user` until it expires. The
CLI cannot fix that for you, and pretending otherwise would be a security lie.

---

## 2. Why two tokens

| | Access token | Refresh token |
|---|---|---|
| Lifetime | 15 min | 7 days |
| Sent as | `Authorization: Bearer …` | httpOnly cookie |
| Readable by JS | yes (has to be) | **no** |
| Signed with | `JWT_SECRET` | `JWT_REFRESH_SECRET` |
| Reusable | until it expires | **once**, then rotated |
| Purpose | every API call | getting a new access token |

**Separate secrets.** If the same secret signed both, a leaked access token
could be replayed to the refresh endpoint and turned into a week-long session.
Two secrets make the token types cryptographically independent.

**15-minute access tokens.** The window in which a stolen access token is useful
is bounded by its own expiry, not by how quickly someone notices. Short tokens
mean a leaked one dies on its own.

**Single-use refresh tokens.** See §5.

---

## 3. What a JWT is, and the mistake everyone makes

A JWT is **signed, not encrypted**. Anyone holding one can read every claim:

```
eyJhbGciOiJIUzI1NiJ9 . eyJzdWIiOiIxMjMiLCJyb2xlIjoiYWRtaW4ifQ . signature
└──── readable ──────┘ └────── readable ────────┘   └─ HMAC of both ─┘
```

Two consequences, both enforced in `token.service.ts`:

1. **Never put secrets in the payload.** If you added `password` to the claims it
   would be readable by anyone who saw the token. The claims here are `sub`,
   `email`, `role` — nothing else.
2. **Never trust a payload you have not verified.** `jwt.decode()` does *no*
   cryptography; it just base64s. Only `jwt.verify()` checks the signature and
   the expiry, and it is the only function that touches a client token.

### The `alg: none` bypass

The classic JWT vulnerability. An attacker takes a token, replaces the header
with `{"alg":"none"}`, empties the signature, and sets `role: "admin"`. Some
libraries used to accept that.

The fix is one option:

```ts
jwt.verify(token, secret, { algorithms: ['HS256'], issuer });
```

`algorithms` is an **allow-list**, so the token's own header cannot choose. It is
not optional and not decorative. There is a test for this
(`rejects an unsigned token with alg: none`).

---

## 4. Passwords

**Never stored. Only a bcrypt hash.**

```ts
const passwordHash = await hashPassword(body.password);   // cost 10
```

- **Why not SHA-256?** SHA-256 is designed to be *fast*. A GPU does billions per
  second, so a stolen table of SHA-256 password hashes can be brute-forced at
  that rate. Password hashing is deliberately slow and memory-hard.
- **Cost 10** is ~60–100 ms per hash: slow enough to be expensive to attack,
  fast enough that login feels instant. It can be raised later — the cost is
  stored inside the hash, so old hashes keep verifying.
- **Salts are automatic.** Two users with the password `hunter2` get different
  hashes, which is why verification must use `bcrypt.compare` and never `===`.
- **72-character cap.** bcrypt silently ignores everything past 72 bytes. A
  10,000-character password would give an attacker a far cheaper target without
  the user knowing, so it is rejected instead.
- **Policy:** 12+ characters and three character classes (lower / upper / digit /
  symbol), plus a small blocklist of breach-common passwords. Length beats
  punctuation — `correct horse battery staple` is stronger *and* easier to
  remember than `P@ssw0rd1`.

`bcryptjs` (pure JS) rather than `bcrypt` (native addon) so the project installs
without a compiler toolchain. Identical hash format.

### The hash cannot leak by accident

`User` (with `passwordHash`) and `PublicUser` (without) are different types, and
every response goes through `toPublicUser()`. Returning a `User` directly would
typecheck fine and quietly publish the hash — the conversion is what prevents it.
Tests assert the response never contains `passwordHash`.

---

## 5. Refresh token rotation and theft detection

JWTs cannot be un-issued. That single fact shapes this whole area.

**Stored server-side.** Every refresh login writes a row to `refresh_tokens`
containing a **SHA-256 hash** of the token — never the token itself. A database
dump therefore yields hashes that cannot be replayed as sessions.

**Bound to its row.** The session id is generated first, embedded in the token as
its `jti` claim, *and* used as the row's primary key. A token with no matching
live row is rejected, so deleting the row kills the token immediately instead of
waiting up to 7 days for it to expire.

**Single use.** `/api/auth/refresh` consumes the row atomically:

```sql
UPDATE refresh_tokens SET used_at = $2
 WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL
```

Two concurrent requests with the same token: exactly one gets `rowCount 1`. The
other gets 0.

**Replay means theft.** When consumption fails, the original token was already
used — so either the real client used it and this is a stolen copy, or the
reverse. We cannot tell which, so we assume the worst: **revoke every session for
that user** and return 401 `TOKEN_REUSE`. The legitimate user is logged out and
must sign in again, which is a visible, recoverable annoyance rather than a
silent compromise.

Verified end to end: refresh → replay the old token → 401 → *and* the newly
issued token is dead too.

---

## 6. Not leaking information through errors

**Login failures are indistinguishable.** Wrong password, unknown email, and
disabled account all return the same `401 INVALID_CREDENTIALS` with the same
message. "Account not found" vs "wrong password" would turn `/api/auth/login`
into an email-enumeration oracle.

**Timing is equalised too.** A missing account still runs bcrypt — against a
fixed dummy hash. Without that, an unknown email returns in ~2 ms while a real
one takes ~100 ms, and that gap is enough to enumerate accounts remotely.

**Token failures are indistinguishable.** `verifyAccessToken` collapses expired,
tampered, wrong-secret and wrong-issuer into one `401 Invalid or expired access
token`. Differentiating them hands an attacker a probing oracle.

**Passwords are never echoed.** No response, log line or error message contains
a submitted password.

---

## 7. Cookies

The refresh token is set as an httpOnly cookie, scoped to the auth routes:

```
refresh_token=…; Max-Age=604800; Path=/api/auth; HttpOnly; SameSite=Strict
```

| Flag | Stops |
|---|---|
| `HttpOnly` | JavaScript reading it — **the main one**. XSS gets a 15-min access token, not a 7-day session. |
| `Secure` (production only) | The token going out in clear text over HTTP. Off locally, or the browser would never return it over `http://localhost`. |
| `SameSite=Strict` | CSRF against `/api/auth/refresh` — the browser will not attach the cookie to another site's request. |
| `Path=/api/auth` | The cookie rides along on as few requests as possible. |

**Why the body also carries a refresh token.** Native apps, curl and Postman have
no cookie jar and would have no way to refresh without it. The web client
**ignores** the copy in the body and uses the cookie — a token JavaScript can read
is a token XSS can steal.

**Why logout is public.** It looks wrong ("only signed-in users should log out!")
but consider an expired access token: the client calls logout, gets a 401, and
can no longer end its own session. Requiring a token to *destroy* a session is a
trap. It is safe without one because it can only revoke, never grant. Logout is
idempotent, so a stale token is not an error.

---

## 8. Client-side token handling

| Token | Where | Why |
|---|---|---|
| Access | memory + `sessionStorage` | Needed by JS. `sessionStorage` (not `localStorage`) so closing the tab signs you out on a shared machine. |
| Refresh | httpOnly cookie only | Never enters JS. |

- Proactive refresh ~30 s before expiry, so the common case never wastes a
  round-trip on a request that is about to be rejected.
- One 401 → one refresh → one retry. Never a loop.
- **Concurrent 401s share a single refresh.** This matters: refresh tokens are
  single-use, so three parallel refreshes would mean two "replays", which the
  server would correctly read as theft and revoke every session.
- On page load the app asks `/api/auth/me` rather than trusting the stored token.
  Decoding a token locally looks fine right up until the signing secret changes
  or the account is disabled — exactly when it matters.

---

## 9. Configuration safety

- `JWT_SECRET` and `JWT_REFRESH_SECRET` are **required**, minimum 32 characters.
  Missing config exits at startup with a clear message instead of failing later
  in a confusing place.
- In production the server **refuses to boot** if either secret still contains a
  placeholder (`change-me`, `secret`, `test`, …). "I'll use the example secret
  for now" is how real breaches happen.
- TTL format is validated (`15m`, `7d`) — a typo cannot silently become
  "no expiry".
- `.env` is git-ignored; `.env.example` holds placeholders only. The secrets in
  the local `.env` were generated on this machine with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- Tests use their own throwaway secrets (`vitest.config.mts`), so a test can
  never pass because of the developer's real `.env` — and cannot fail in CI.

---

## 10. Known limitations

Honest list of what is **not** handled yet:

1. **No rate limiting on `/api/auth/login` or `/register`.** This is the biggest
   gap. Without it, login can be brute-forced online and registration can be used
   to fill the database. Add `express-rate-limit` (strict on login, e.g. 5/min/IP;
   looser on register) plus a per-account lockout.
2. **No email verification.** Anyone can register any address, including one they
   do not own. Needs a verification table and a signed, expiring link.
3. **No password reset.** Needs a single-use, hashed, expiring token in its own
   table — the same pattern as refresh sessions.
4. **Items are not scoped per user.** Every authenticated user sees and edits
   every item. `items` has no `created_by` column yet. The next step is
   `created_by UUID REFERENCES users(id)` plus a `WHERE created_by = $1` in the
   repository, and `requireRole('admin')` on any route that lists across users.
   (Delete is already admin-only — §1a — but that is a role gate, not ownership.)
5. **A deleted or disabled account keeps working for up to 15 minutes.** The
   access token is stateless, so it cannot be consulted against the database on
   every request. Acceptable at this scale; if it is not, add a
   `token_version` column on `users`, put it in the payload, and compare on each
   request (cheap lookup, immediate revocation).
6. **`role` comes from the token, not the database.** A role change therefore
   takes up to 15 minutes to apply. Same fix as above.
7. **No `trust proxy`.** `req.ip` is the socket address, so behind a load
   balancer every session records the proxy's IP. Recorded for auditing only —
   no access decision depends on it.
8. **No token revocation list for access tokens.** Logout kills the refresh
   session, but an access token already issued stays valid until it expires.
9. **Secrets are not rotatable at runtime.** Changing `JWT_SECRET` logs everyone
   out. Supporting both secrets during a rollover would need a key id (`kid`)
   claim.
10. **No MFA, no audit log of security events** beyond `console` lines.

---

## 11. Testing

`tests/auth.test.ts` (43 tests). Roughly half are **attack** tests, named after
what they prevent — a suite that only proves the happy path will happily accept
an implementation with a critical hole, because the hole is only visible when
someone tries to exploit it.

Covered: payload edited to `role: admin`; `alg: none`; refresh secret used as an
access token; foreign `iss`; expired token; garbage token; refresh replay →
all sessions revoked; unknown email vs wrong password indistinguishable; no
password hash in any response; `HttpOnly` / `SameSite=Strict` / `Path` on the
cookie.

`tests/api.test.ts` covers the authorisation side: a signed-in `user` gets `403`
on delete and the item survives; an `admin` gets `204`; an anonymous caller gets
`401`; and the `403` body does not name the required role. The admin tests get
their token by promoting a user in the repository and **logging in again** —
never by forging a token, since only the server may sign one.

Each attack has a matching assertion, e.g.:

```ts
it('rejects a payload edited to claim the admin role', async () => {
  const [header, payload] = user.accessToken.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  claims.role = 'admin';
  const forged = `${header}.${...}.not-a-real-signature`;
  // -> 401
});
```

Also verified by hand against real PostgreSQL 18: 401 without a token, login,
listing and creating items, `/me`, cookie flags, rotation, replay detection.

---

## 12. If you take one thing from this

**JWTs are not sessions.** They are signed claims with an expiry, and the
signature is the only thing standing between an attacker and whatever the payload
says. Verify with `jwt.verify` and an algorithm allow-list, keep the payload
minimal, keep it short-lived, and re-read anything that must reflect current
state — a role, an enabled flag — from the database instead of trusting it.

---

## 13. Rotating the secrets

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Put one value in `JWT_SECRET` and a **different** one in `JWT_REFRESH_SECRET`,
restart. Everyone is signed out — that is the intended effect, not a bug.