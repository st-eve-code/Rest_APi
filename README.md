# REST API

A small, well-organised REST API for managing **items**, built with:

| Concern | Tool | Why |
|---|---|---|
| HTTP server | **Express 5** | The standard Node web framework |
| Language | **TypeScript + plain JavaScript** | Types where they help, JS allowed where they don't |
| Validation | **Zod 4** | The schema *is* the validator, and it gives you types |
| Database | **PostgreSQL** (`pg`) | Real, persistent storage |
| Auth | **JWT + bcrypt** | Stateless access tokens, revocable refresh sessions |
| Tests | **Vitest + Supertest** | Real HTTP requests, no database needed |
| Types | **TypeScript 7** | Catches bugs before you run the code |
| Frontend | **React 19 + Vite 7** | A real UI for every endpoint, in `client/` |

The API supports **CRUD**, **filtering by status**, **pagination**, and
**validation with clear error messages**. All of it requires a **signed-in user** —
see [section 5](#5-api-reference) and, for the reasoning behind every security
decision, **[SECURITY_NOTES.md](SECURITY_NOTES.md)**.

---

## Table of contents

1. [Quick start (60 seconds, no database)](#1-quick-start-60-seconds-no-database)
2. [Full setup with PostgreSQL](#2-full-setup-with-postgresql)
3. [Web UI (React + Vite)](#3-web-ui-react--vite)
4. [Available commands](#4-available-commands)
5. [API reference](#5-api-reference)
6. [Project structure](#6-project-structure)
7. [How a request flows through the app](#7-how-a-request-flows-through-the-app)
8. [Key concepts explained](#8-key-concepts-explained)
9. [Testing](#9-testing)
10. [JavaScript vs TypeScript in this project](#10-javascript-vs-typescript-in-this-project)
11. [Switching to MySQL](#11-switching-to-mysql)
12. [Troubleshooting](#12-troubleshooting)
13. [Where to go next](#13-where-to-go-next)

---

## 1. Quick start (60 seconds, no database)

You do **not** need to install PostgreSQL to start. The app can store data in a
plain JavaScript array, which is perfect for learning the endpoints.

```bash
# 1. install dependencies
npm install

# 2. create your .env file
cp .env.example .env          # macOS / Linux
Copy-Item .env.example .env   # Windows PowerShell

# 3. replace the two JWT secrets with your own (see below)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. run it
npm run dev
```

> **Step 3 is not optional.** The server validates its config at startup and
> refuses to boot without a real `JWT_SECRET` and `JWT_REFRESH_SECRET`. Run the
> command twice and paste each result into a different line in `.env`:
>
> ```env
> JWT_SECRET=<first output>
> JWT_REFRESH_SECRET=<second output>
> ```
>
> They must differ. In production the server also refuses to start if either
> value is still one of the placeholders from `.env.example`.

You should see:

```
  ------------------------------------------------
   Server ready at http://localhost:3000
   Environment : development
   Storage     : in-memory (resets on restart)
   Health check: http://localhost:3000/health
  ------------------------------------------------
```

**Everything except `/health` needs a signed-in user**, so create one:

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"Correct-Horse-42"}'
```

The response contains an `accessToken`. Use it on every other call:

```bash
curl http://localhost:3000/api/items -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Or just open the web UI and sign up through the form — see
[section 3](#3-web-ui-react--vite).

Passwords must be 12–72 characters with three character classes (lower case,
upper case, digit, symbol), which is why the example above is longer than
`Password123`.

The web UI needs its own dependencies the first time. Either run `npm run dev`
for the API only and follow [section 3](#3-web-ui-react--vite) to add the UI, or
install both up front:

```bash
npm install --prefix client
```

Check the server is up:

```bash
curl http://localhost:3000/health
```

```json
{"success":true,"data":{"status":"ok","uptimeSeconds":3}}
```

> **Note:** in-memory data disappears every time you restart the server — including
> your user account, so you would have to register again. Section 2 shows how to
> switch to a real database.

---

## 2. Full setup with PostgreSQL

### Step 1 — install PostgreSQL

Download and install it from <https://www.postgresql.org/download/>. The
installer asks for a superuser password — remember it, you will need it next.

You can verify the install:

```bash
psql --version
```

### Step 2 — create the database

Open a terminal and run:

```bash
psql -U postgres
```

Then, inside the `psql` prompt:

```sql
CREATE DATABASE ado_test;
\q
```

### Step 3 — point the app at it

Edit `.env`:

```env
DB_DRIVER=postgres
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/ado_test
```

Also set `JWT_SECRET` and `JWT_REFRESH_SECRET` here if you skipped
[section 1](#1-quick-start-60-seconds-no-database) — the server will not start
without them.

If your PostgreSQL server is not running, start it:

- **Windows:** search "Services" → find `postgresql-x64-18` → Start.
- **macOS:** `brew services start postgresql`

### Step 4 — create the tables

```bash
npm run db:migrate
```

This applies [`db/schema.sql`](db/schema.sql), which creates the `item_status`
and `user_role` types, the `items` and `users` tables, the `refresh_tokens`
session table, and their indexes. It is safe to run more than once because every
statement uses `IF NOT EXISTS` / `ON CONFLICT` guards.

### Step 5 — add some sample data

```bash
npm run db:seed
```

This inserts four items **and** a demo account you can log in with immediately:

```text
email    : demo@example.com
password : Correct-Horse-42
role     : admin
```

> ⚠️ `db:seed` **deletes everything** in `items` first. Never point it at real
> data. It leaves an existing `demo@example.com` account alone, so changing that
> password and re-seeding will not undo the change.

### Step 6 — run it

```bash
npm run dev
```

The startup banner now says `Storage : PostgreSQL`, and your data survives restarts.

---

## 3. Web UI (React + Vite)

`client/` is a React app that operates every endpoint: list, search, filter by
status, paginate, create, edit and delete. It starts on a **sign-in screen**,
because none of that is reachable without a token.

### Running it

```bash
# first time only
npm install
npm install --prefix client

# starts BOTH servers in one terminal
npm run dev
```

| Server | URL | Started by |
|---|---|---|
| API (Express) | http://localhost:3000 | `npm run dev:api` |
| UI (Vite) | **http://localhost:5173** | `npm run dev:web` |

Open **http://localhost:5173**. To run them in separate terminals instead, use
`npm run dev:api` and `npm run dev:web` separately.

### Signing in

Use `demo@example.com` / `Correct-Horse-42` after `npm run db:seed`, or switch to
**Register** and make your own account. Either way the app then holds an access
token in `sessionStorage` and a refresh token in an httpOnly cookie the browser
sends for you — the UI never sees the refresh token, and never has to store it.

### Why the UI does not hit port 3000 directly

Vite proxies `/api` and `/health` to the API (`client/vite.config.ts`). To the
browser there is only **one origin**, so every request in `client/src` uses a
plain relative path like `/api/items`. Without the proxy you would be fighting
CORS, and the app would also break the moment it was deployed behind one domain.

### What the UI demonstrates

| File | What to look at |
|---|---|
| `client/src/types.ts` | The API contract, mirrored from the server |
| `client/src/api/http.ts` | One `request()` that unwraps `{ success, data, meta }` and throws a typed `ApiRequestError` |
| `client/src/api/session.ts` | Where the access token lives, and when it silently refreshes |
| `client/src/api/auth.ts` | Login / register / refresh / logout |
| `client/src/hooks/useAuth.ts` | The signed-in user, and restoring the session on page load |
| `client/src/hooks/useItems.ts` | Fetch + loading + error state, with `AbortController` so a slow response cannot overwrite a newer one |
| `client/src/hooks/useDebouncedValue.ts` | Search box waits for a pause before requesting |
| `client/src/components/AuthForm.tsx` | The login / register gate in front of everything |
| `client/src/components/ItemForm.tsx` | Create and edit in one form; PATCH sends **only changed fields** |
| `client/src/components/ItemTable.tsx` | Distinguishes *loading* from *no results* |
| `client/src/components/Pagination.tsx` | Driven by the server's `meta`, never recomputed locally |

Three details worth copying into your own code:

- **The server is the only validator.** The form does not re-implement the
  200-character title limit; it renders whatever the API rejects next to the
  offending input, so the two can never disagree.
- **The form keys off `error.code`.** A `BAD_REQUEST` highlights fields; a
  `NOT_FOUND` or a dead server shows a banner instead.
- **A `401` triggers exactly one refresh, then one retry.** Concurrent `401`s
  share a single in-flight refresh, because refresh tokens are single-use — three
  parallel refreshes would look like token theft and the server would (correctly)
  revoke every session.

### Production build

```bash
npm run build:web     # -> client/dist (static files)
npm run preview:web   # serve that build locally
```

The server does not serve `client/dist` yet. To deploy them together, mount the
folder in `app.ts` **before** the routes and after `express.json()`:

```ts
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
```

---

## 4. Available commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the API **and** the web UI together |
| `npm run dev:api` | Starts just the server, with auto-restart (`tsx watch`) |
| `npm run dev:web` | Starts just the Vite dev server on :5173 |
| `npm run build` | Compiles TypeScript to plain JavaScript in `dist/` |
| `npm run build:web` | Type-checks and bundles the UI into `client/dist` |
| `npm start` | Runs the compiled build from `dist/` (production) |
| `npm run preview:web` | Serves the built UI locally |
| `npm run typecheck` | Checks every server type without emitting files |
| `npm run typecheck:web` | Same, for the UI |
| `npm test` | Runs the test suite once |
| `npm run test:watch` | Runs tests and re-runs them on every change |
| `npm run db:migrate` | Applies `db/schema.sql` to the database |
| `npm run db:seed` | Inserts sample items + the demo user (**wipes `items` first**) |
| `npm run db:make-admin -- <email>` | Promotes an account to admin (`[admin\|user]` to demote) |

---

## 5. API reference

Base URL: `http://localhost:3000`

### Authentication

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/register` | – | Create an account, returns tokens |
| `POST` | `/api/auth/login` | – | Exchange credentials for tokens |
| `POST` | `/api/auth/refresh` | refresh token | Rotate the pair, get a new access token |
| `POST` | `/api/auth/logout` | – | Revoke this session, clear the cookie |
| `POST` | `/api/auth/logout-all` | access token | Revoke every session for this user |
| `GET` | `/api/auth/me` | access token | The signed-in user |

### Signing in

After `npm run db:seed` there is one pre-made account:

```text
email    : demo@example.com
password : Correct-Horse-42
role     : admin
```

Or register your own — you will be a `user`, which can do everything **except**
delete (see below).

### Who can delete

| Role | Read | Create | Update | **Delete** |
|---|---|---|---|---|
| `user` | yes | yes | yes | **403** |
| `admin` | yes | yes | yes | yes |

Deletion is the one irreversible operation here, so it is the one restricted:

```bash
# as a normal user
curl -X DELETE http://localhost:3000/api/items/<ID> \
  -H "Authorization: Bearer A_NORMAL_USER_TOKEN"
# -> 403 {"error":{"code":"FORBIDDEN", ...}}
```

The item is untouched. `401` means no valid token, `403` means valid token, wrong
role — a client that gets `403` must not retry with the same token.

### Making yourself an admin

Registration always creates a `user`; there is deliberately **no API endpoint**
that grants admin (that would be a privilege-escalation hole). Promote yourself
from the CLI, which requires database access:

```bash
npm run db:make-admin -- you@example.com          # promote
npm run db:make-admin -- you@example.com user     # demote
```

**Then sign in again.** The role lives inside the access token, so the token you
already hold keeps the old role until it expires (15 minutes).

### Items (all require an access token)

| Method | Path | Purpose | Success code |
|---|---|---|---|
| `GET` | `/health` | Liveness check (**public**) | `200` |
| `GET` | `/api/items` | List items (filter + paginate) | `200` |
| `GET` | `/api/items/:id` | Fetch one item | `200` |
| `POST` | `/api/items` | Create an item | `201` |
| `PATCH` | `/api/items/:id` | Update some fields | `200` |
| `DELETE` | `/api/items/:id` | Delete an item (**admin only**) | `204` |

Missing or invalid token on any of those six:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required",
    "details": []
  }
}
```

### Register

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"Correct-Horse-42"}'
```

- `email` — required, valid email, unique (duplicate → `409 CONFLICT`).
- `password` — required, 12–72 characters, three character classes.
- `role` — **cannot be set here**; everyone who registers is a `user`.

### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"Correct-Horse-42"}'
```

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "7b533e0d-a606-43c9-9e22-a49c3c4f7f9b",
      "email": "you@example.com",
      "role": "user",
      "createdAt": "2026-10-04T07:17:32.841Z",
      "updatedAt": "2026-10-04T07:17:32.841Z"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 900
  }
}
```

A wrong password and an unknown email return the **same** `401
INVALID_CREDENTIALS`, so the endpoint cannot be used to discover which emails
have accounts. `expiresIn` is seconds.

The refresh token is *also* set as an httpOnly, `SameSite=Strict` cookie scoped to
`/api/auth`. Browsers ignore the copy in the body; curl, Postman and native apps
have no cookie jar, so they use it.

### Authenticating requests

```bash
curl http://localhost:3000/api/items \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Access tokens last 15 minutes. When one expires you get a `401`, then:

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"YOUR_REFRESH_TOKEN"}'
```

Refresh tokens are **single use**. Each refresh returns a brand new pair and
invalidates the old one. Sending a token that has already been used is treated as
theft: `401 TOKEN_REUSE`, and **every session for that user is revoked**.

Signing in again issues a second independent session, so signing in on your phone
does not log out your laptop. Only `logout-all` clears them all.

How each of these decisions was made, and what is deliberately *not* handled
yet, is in **[SECURITY_NOTES.md](SECURITY_NOTES.md)**.

### The Item shape

```json
{
  "id": "9b1d7d5e-0f7a-4c1a-9a8f-2b3c4d5e6f70",
  "title": "Learn Express",
  "description": "Read the docs",
  "status": "todo",
  "createdAt": "2026-10-03T09:15:00.000Z",
  "updatedAt": "2026-10-03T09:15:00.000Z"
}
```

`status` is always one of `todo`, `in_progress`, `done`.
`description` is `null` when not provided.

### Response envelope

Every response has the same shape, so a client can rely on it.

**Success**

```json
{
  "success": true,
  "data": { "...": "..." },
  "meta": { "...": "only on list endpoints" }
}
```

**Failure**

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Validation failed",
    "details": [{ "field": "title", "message": "Title is required" }]
  }
}
```

### `GET /api/items`

| Query parameter | Type | Default | Notes |
|---|---|---|---|
| `status` | `todo` \| `in_progress` \| `done` | – | Exact match |
| `title` | string | – | Case-insensitive "contains" |
| `page` | number ≥ 1 | `1` | |
| `pageSize` | number 1–100 | `20` | Capped so one client cannot ask for everything |

Filters combine with AND:

```bash
curl "http://localhost:3000/api/items?status=done&title=express" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

`meta` tells you what you did not get:

```json
{
  "total": 3,
  "page": 2,
  "pageSize": 1,
  "totalPages": 3,
  "hasNextPage": true,
  "hasPreviousPage": true
}
```

### `POST /api/items`

```bash
curl -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{"title":"Learn Express","description":"Read the docs"}'
```

- `title` — **required**, 1–200 characters after trimming.
- `description` — optional, up to 2000 characters.
- `status` — optional, defaults to `todo`.

Returns `201` with a `Location` header pointing at the new item.

### `PATCH /api/items/:id`

Only the fields you send are changed. Send `null` to clear `description`.

```bash
curl -X PATCH http://localhost:3000/api/items/<ID> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{"status":"in_progress"}'
```

`title`, `description` and `status` stay as they were.

### `DELETE /api/items/:id`

**Admin only** — returns `403 FORBIDDEN` for a signed-in non-admin, and `401` if
there is no valid token. Returns `204 No Content` with an empty body.

### Error codes

| Status | `error.code` | Meaning |
|---|---|---|
| `400` | `BAD_REQUEST` | Malformed body, bad query string, failed validation |
| `401` | `UNAUTHORIZED` | Missing, malformed, expired or tampered access token |
| `401` | `INVALID_CREDENTIALS` | Wrong email **or** password — deliberately indistinguishable |
| `401` | `TOKEN_REUSE` | A refresh token was replayed, so **every session was revoked** |
| `403` | `FORBIDDEN` | Authenticated, but the role is not allowed |
| `404` | `NOT_FOUND` | No item with that id, or no matching route |
| `409` | `CONFLICT` | Would violate a database rule (e.g. duplicate email or title) |
| `422` | `VALIDATION_ERROR` | Reserved for future schema-validation failures |
| `500` | `INTERNAL_ERROR` | A bug on our side. Details are logged, never returned |

Validation always reports **every** bad field at once, so a client does not have
to guess one field per round trip:

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Validation failed",
    "details": [
      { "field": "title", "message": "Title is required" },
      { "field": "status", "message": "Status must be one of: todo, in_progress, done" }
    ]
  }
}
```

---

## 6. Project structure

```
core/
├── .env.example            # template for your .env
├── SECURITY_NOTES.md       # how the auth works, and what is still missing
├── db/
│   └── schema.sql          # tables, enums and indexes (items, users, refresh_tokens)
├── src/
│   ├── server.ts           # ENTRY POINT: connects DB, listens, shuts down
│   ├── app.ts              # builds the Express app (no listen) -> testable
│   ├── config/index.ts     # reads + validates .env once, at startup
│   ├── types/
│   │   ├── item.ts         # Item, ItemStatus, input types
│   │   └── user.ts         # User (with passwordHash) + PublicUser (without)
│   ├── lib/
│   │   ├── ApiError.ts     # errors with an HTTP status attached
│   │   ├── ApiResponse.js  # [JS] success/error response helpers
│   │   └── http.ts         # getPathParam() helper
│   ├── middleware/
│   │   ├── authenticate.ts # reads the Bearer token, attaches req.user
│   │   ├── notFound.js     # [JS] 404 for unmatched routes
│   │   └── errorHandler.ts # the single place errors become JSON
│   ├── db/
│   │   ├── pool.ts         # connection pool + query helpers
│   │   ├── migrate.ts      # applies db/schema.sql
│   │   └── seed.ts         # sample items + the demo user
│   └── features/
│       ├── items/          # ONE FOLDER PER RESOURCE
│       │   ├── itemRepository.ts       # the interface both implementations follow
│       │   ├── inMemoryItemRepository.ts
│       │   ├── postgresItemRepository.ts
│       │   ├── items.validator.ts      # Zod schemas + clear messages
│       │   ├── items.service.ts        # business rules
│       │   ├── items.controller.ts     # HTTP in / objects out
│       │   └── items.routes.ts         # URL -> controller function (all authed)
│       └── auth/           # exactly the same shape, plus:
│           ├── token.service.ts         # sign + verify access/refresh tokens
│           ├── password.ts              # bcrypt hash / compare / strength
│           ├── userRepository.ts        # + a refresh-token session store
│           ├── postgresUserRepository.ts
│           ├── inMemoryUserRepository.ts
│           ├── auth.validator.ts        # register/login schemas
│           ├── auth.service.ts          # register, login, refresh, logout
│           ├── auth.controller.ts       # also sets/clears the httpOnly cookie
│           └── auth.routes.ts
├── client/                 # [React 19 + Vite 7] the web UI
│   ├── vite.config.ts      # dev server + /api proxy to :3000
│   └── src/
│       ├── main.tsx              # React entry point
│       ├── App.tsx               # AuthGate -> ItemsScreen
│       ├── types.ts              # the API contract, mirrored from the server
│       ├── styles.css            # all styling, dark mode via custom properties
│       ├── api/
│       │   ├── session.ts        # access token holder + single-flight refresh
│       │   ├── http.ts           # request() -> envelope + typed errors + 401 retry
│       │   ├── auth.ts           # login / register / refresh / logout
│       │   └── items.ts          # one function per endpoint
│       ├── hooks/
│       │   ├── useAuth.ts        # the signed-in user, restored on page load
│       │   ├── useItems.ts       # fetch + loading + error, with AbortController
│       │   └── useDebouncedValue.ts
│       └── components/
│           ├── AuthForm.tsx     # login / register gate
│           ├── ItemsScreen.tsx  # the screen behind the gate
│           ├── ItemTable.tsx    # the list + row actions
│           ├── ItemForm.tsx     # create AND edit
│           ├── Filters.tsx      # status / title / page size
│           ├── Pagination.tsx   # driven by the server's meta
│           ├── ConfirmDialog.tsx# "are you sure?" before a delete
│           └── Alert.tsx        # success / error banner
├── tests/
│   ├── api.test.ts         # full-stack tests over real HTTP
│   ├── auth.test.ts        # auth flows AND attack attempts
│   └── repository.test.ts  # unit tests for service + repository
├── tsconfig.json           # typechecking config
├── tsconfig.build.json     # build-only config
└── vitest.config.mts
```

Everything for one resource lives together in `features/`. Adding a third resource
means copying that shape — `features/items/` and `features/auth/` never need to
change.

---

## 7. How a request flows through the app

Take `POST /api/items` with `{"description":"no title"}` and no token:

```
1.  cors()                 adds CORS headers, calls next()
2.  express.json()         parses the body into req.body, calls next()
3.  cookieParser()         attaches req.cookies (the refresh token lives here)
4.  request logger         starts a stopwatch, calls next()
5.  authenticate.ts        no Authorization header -> next() is never called
6.  items.routes.ts        router.use(authenticate) stops here, so the
                             POST / below it never runs
7.  errorHandler.ts        catches the ApiError -> sends 401 JSON
```

The one rule to remember: **middleware runs in the order you register it**, and
error/404 handlers must be registered *last* or they will never run.

The second rule, added by authentication: `router.use(authenticate)` sits at the
top of `items.routes.ts` rather than on each route, so **every** route in that
file is private by default. The failure mode of forgetting it is the one that
matters, so it is the one the code makes impossible.

A request that *is* authenticated, with a valid token, continues to step 6 and
fails validation instead:

```
6.  items.routes.ts        POST /  matches  ->  controller.create
7.  items.controller.ts    validates req.body with createItemSchema
       └─ fails -> throws ApiError(400, details)
8.  items.service.ts       (never runs — the throw skipped it)
9.  errorHandler.ts        catches the ApiError -> sends 400 JSON
```

---

## 8. Key concepts explained

### The four layers

| Layer | Knows about | Must NOT know about |
|---|---|---|
| **Route** | URLs | business rules, SQL |
| **Controller** | `req` / `res` | business rules, SQL |
| **Service** | plain objects | Express, SQL |
| **Repository** | SQL / storage | HTTP, business rules |

The point is not tidiness for its own sake. Because the service never imports
Express, you can call it from a CLI script, a cron job or a WebSocket handler
without inventing a fake `req` and `res`. Because the repository never imports
HTTP, you can swap storage engines.

### Dependency injection — the most important idea in this project

`ItemService` does not create its own storage. It *receives* it:

```ts
new ItemService(repository)
```

So `app.ts` decides what it actually gets:

```ts
const itemRepository = repository ?? (config.usesDatabase
  ? new PostgresItemRepository()
  : new InMemoryItemRepository());
```

Both classes implement the same `ItemRepository` interface, so the code above them
cannot tell the difference. That single line is why:

- `npm test` runs in ~3 seconds with no database installed,
- switching between an array and PostgreSQL is a config change, not a rewrite.

### Why there are two repository implementations

| | `InMemoryItemRepository` | `PostgresItemRepository` |
|---|---|---|
| Storage | JavaScript `Map` | PostgreSQL table |
| Setup | none | install + configure PostgreSQL |
| Survives restart | no | yes |
| Used by | tests, `DB_DRIVER=memory` | `DB_DRIVER=postgres` |

### Authentication belongs in middleware, not in controllers

The temptation is to check the token inside each controller:

```ts
// DON'T — one of these five will get forgotten
async function create(req, res) {
  const user = verifyToken(req);   // ...and then what? pass it where?
  ...
}
```

That pushes an HTTP concern into the business layer, and makes "did you remember?"
the security model. Instead `authenticate` runs first and hangs the user off the
request:

```ts
declare global {
  namespace Express {
    interface Request { user?: AuthUser }   // set by authenticate.ts
  }
}
```

Controllers can then read `req.user` if they need it (they mostly do not — the
handlers stay unchanged) and no route can be left unprotected by accident. See
[SECURITY_NOTES.md](SECURITY_NOTES.md) for the token design itself.

### Always use SQL placeholders

```ts
// SAFE — the driver escapes the value
await query('SELECT * FROM items WHERE status = $1', ['done']);

// DANGEROUS — SQL injection
await query(`SELECT * FROM items WHERE status = '${userInput}'`);
```

You will see the safe form in `postgresItemRepository.ts` everywhere. The rule
is absolute: user input only ever travels in the `values` array.

### `ApiError` versus `Error`

`new Error('something broke')` means *"I have no idea what happened"* — the
client gets a bare `500`.

`ApiError.badRequest('Title is required')` means *"I know exactly what happened"*
— the client gets that message and the right status code.

Use `ApiError` for anything the **client** did wrong. Let plain `Error`s bubble
up for bugs.

### Zod: validate and type in one step

```ts
const createItemSchema = z.object({
  title: z.string({ error: 'Title is required' }).trim().min(1, 'Title is required'),
  status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
});

const body = validate(createItemSchema, req.body);
//      ^ body.title is now GUARANTEED to be a trimmed non-empty string
```

Zod does the checking at runtime *and* gives you the static type at compile time.
Neither one alone is as useful as both together.

Note that we wrote friendly messages by hand. Zod's default `"String must contain
at least 1 character(s)"` is accurate but unhelpful — this is your API's voice,
so you control it.

### `app.ts` versus `server.ts`

- `app.ts` **builds** the app. It never calls `listen()`. Tests import this.
- `server.ts` **runs** it: checks the database, opens a port, handles Ctrl+C.

This split is what makes an API testable without a port.

### Graceful shutdown

Pressing Ctrl+C normally kills the process mid-query. `server.ts` instead stops
accepting connections, lets in-flight requests finish, closes the database pool,
and exits — with a 10-second watchdog so a hung cleanup cannot wedge the process.

---

## 9. Testing

```bash
npm test
```

```
 Test Files  2 passed (2)
      Tests  50 passed (50)
```

### No database required

`tests/api.test.ts` builds the real Express app but injects
`InMemoryItemRepository`:

```ts
beforeEach(() => {
  repository = new InMemoryItemRepository();
  app = createApp({ repository });
});

it('rejects a missing title with a clear message', async () => {
  const response = await request(app).post('/api/items').send({ description: 'orphan' });

  expect(response.status).toBe(400);
  expect(response.body.error.details).toContainEqual({
    field: 'title',
    message: 'Title is required',
  });
});
```

These are **integration** tests: real routing, real validation, real error
handling, real JSON over a real HTTP connection (Supertest opens a temporary
local server — no port to manage). Only storage is fake. If they pass, a real
client sending the same request gets the same response.

Every `api.test.ts` case now signs in first, because that is the only way
through the front door any more:

```ts
beforeEach(async () => {
  repository = new InMemoryItemRepository();
  app = createApp({ repository });
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: 'test@example.com', password: 'Correct-Horse-42' });
  accessToken = res.body.data.accessToken;
});

it('rejects a request with no token', async () => {
  await request(app).get('/api/items').expect(401);
});

it('rejects a missing title with a clear message', async () => {
  const response = await request(app)
    .post('/api/items')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ description: 'orphan' });

  expect(response.status).toBe(400);
  expect(response.body.error.details).toContainEqual({
    field: 'title',
    message: 'Title is required',
  });
});
```

### Test the attacks, not just the happy path

`tests/auth.test.ts` has 43 cases, and about half of them are attempts to break
the implementation — a payload edited to `role: admin`, an `alg: none` token, a
refresh secret used as an access secret, an expired token, a foreign `iss`, a
replayed refresh token, an unknown email.

That is deliberate. A suite that only proves login works will happily accept an
implementation with a critical hole, because the hole is only visible when
somebody tries to exploit it — and if nobody does, it is not a hole yet.

`tests/repository.test.ts` contains **unit** tests that skip HTTP entirely. Use
unit tests to pin down exactly which layer broke; use API tests to prove the whole
thing works.

### `beforeEach` matters

The app is rebuilt before every test, so each one starts with empty storage. If
you build it once at the top, tests start sharing state and will eventually fail
in an order-dependent way that is miserable to debug.

### Coverage report

```bash
npx vitest run --coverage
```

---

## 10. JavaScript vs TypeScript in this project

Both are used on purpose, in the same codebase:

| File | Language | Why |
|---|---|---|
| `src/lib/ApiResponse.js` | **JavaScript** | Small, stable, no benefit from types |
| `src/middleware/notFound.js` | **JavaScript** | Simple enough without them |
| everything else | **TypeScript** | Where types genuinely reduce bugs |

`tsconfig.json` sets `allowJs: true`, so the `.ts` files import the `.js` files
directly and TypeScript understands both:

```ts
// items.controller.ts (TypeScript) importing a JavaScript module
import { sendSuccess } from '../../lib/ApiResponse';
```

This is how most real codebases evolve: you do not rewrite old JavaScript to add a
feature next to it. You match the file you are editing.

> **Why this project compiles to CommonJS rather than ESM?** Extensionless imports
> (`'./items.service'`) work everywhere with no `.js` suffix juggling, which removes
> the single most common source of confusion for beginners. See
> [typescriptlang.org](https://www.typescriptlang.org/) if you later want to move
> to native ESM.

---

## 11. Switching to MySQL

Only three files contain PostgreSQL-specific code:

1. `db/schema.sql` — the table and type definitions.
2. `src/features/items/postgresItemRepository.ts` — the item SQL queries.
3. `src/features/auth/postgresUserRepository.ts` — the user and refresh-session
   SQL queries.

To switch:

**1. Install `mysql2` and `@types/mysql2`**, then update `DATABASE_URL` in `.env`
to `mysql://user:password@localhost:3306/ado_test` and add a `mysql` option to
`DB_DRIVER` in `src/config/index.ts`.

**2. Replace the enum.** PostgreSQL's `CREATE TYPE` has no MySQL equivalent. Use a
plain column with a constraint instead:

```sql
CREATE TABLE items (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status ENUM('todo', 'in_progress', 'done') NOT NULL DEFAULT 'todo',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**3. Adjust these SQL differences:**

| PostgreSQL | MySQL |
|---|---|
| `COUNT(*)::text` | `CAST(COUNT(*) AS CHAR)` |
| `TIMESTAMPTZ` | `TIMESTAMP` |
| `$1, $2, $3` placeholders | `?` placeholders |
| `NOW()` | `NOW()` (same) |
| `ILIKE` | `LIKE` (MySQL string comparison is already case-insensitive) |
| `btrim(title)` | `TRIM(title)` |

Nothing else in the app changes, because nothing else knows which database it is
talking to. That is the repository pattern paying for itself.

---

## 12. Troubleshooting

**`Invalid environment variables` on startup**
Your `.env` is missing or wrong. The app lists exactly which keys are the problem.
Remember to *copy* `.env.example` to `.env` — creating `.env` alone does nothing.

**`could not connect to PostgreSQL`**
1. Is the PostgreSQL service running? (`Get-Service postgresql*` / `brew services list`)
2. Does the database exist? (`psql -U postgres -l`)
3. Does `DATABASE_URL` match, including password and port?
4. Is a firewall blocking port 5432?

Quickest way to keep going: set `DB_DRIVER=memory` and carry on learning the API.

**`relation "items" does not exist`**
Run `npm run db:migrate`.

**`EADDRINUSE` / port already in use**
Something else owns port 3000. Change `PORT` in `.env`, or find the culprit:
`netstat -ano | findstr :3000` then `tasklist /FI "PID eq 12345"`.

**Changes not picked up**
`npm run dev` uses `tsx watch` for the API and Vite HMR for the UI. If the API
looks stuck, stop with Ctrl+C and start again.

**The UI says "Could not reach the API"**
The API is not running, or it is on a different port. The UI proxies to
`API_PORT` (default `3000`) — see `client/vite.config.ts`. Set `API_PORT` in
`client/.env` if your server moved, then restart `npm run dev:web` (Vite only
reads env files at startup).

**The UI loads but every request 404s**
You opened `http://localhost:3000` instead of `http://localhost:5173`. The
Express server does not serve the UI in development; :5173 is Vite.

**Port 5173 already in use**
Something else owns it. Vite is configured with `strictPort`, so it fails loudly
rather than silently moving to 5174 and making this README wrong. Free the port,
or change `server.port` in `client/vite.config.ts`.

**`relation "users" does not exist`**
The database was migrated before authentication was added. Run `npm run db:migrate`
again — it is idempotent, so re-running only adds what is missing.

**`Unauthorized` / `401` on every `/api/items` call**
In order of likelihood: the `Authorization` header is missing, or malformed
(`Bearer` + one space + the raw token); the access token is older than 15 minutes
and needs a `/api/auth/refresh` first; the token was signed with a
`JWT_SECRET` different from the one in use now (it changed since you copied
`.env`); or the client is passing the *refresh* token instead of the access token.

**`401 TOKEN_REUSE` and I logged myself out**
Expected, and the security model working. A refresh token was used twice, which
the server cannot distinguish from a stolen copy, so it revokes every session for
that user. Sign in again. If it recurs with no second device involved, the usual
cause is a client firing parallel refreshes — they must share one in-flight
refresh (see `client/src/api/session.ts`).

**The UI signs in and immediately bounces back to the login screen**
Check the browser was not blocking third-party cookies, and that you are on
`http://localhost:5173` through the Vite proxy. The refresh cookie is `SameSite=Strict`
and scoped to `/api/auth`, so the client must reach the API on the **same origin**.

**Login says the credentials are wrong but you are sure they are right**
If you changed `.env` after the account was created, the password hash is fine —
this is not the cause. More likely: you ran `npm run db:seed` with
`DB_DRIVER=memory` while the UI is talking to PostgreSQL (or vice versa), so the
user exists in the other store. Check the `Storage` line in the startup banner.

**The server refuses to start and mentions a placeholder secret**
`NODE_ENV=production` with `JWT_SECRET` or `JWT_REFRESH_SECRET` still set to a
value from `.env.example`. Generate real ones (see
[section 1](#1-quick-start-60-seconds-no-database)).

**"Tests pass but the server 404s"**
Almost always a typo in the URL. Compare against the table in
[section 5](#5-api-reference).

---

## 13. Where to go next

Natural next steps, roughly in order of usefulness. Items 1–4 are the ones that
matter most for security and are listed in full in
[SECURITY_NOTES.md](SECURITY_NOTES.md).

1. **Rate limit `/api/auth/login` and `/register`** — the biggest remaining gap.
   `express-rate-limit` (e.g. 5/min/IP on login) plus a per-account lockout.
2. **Scope items to their owner** — add `created_by UUID REFERENCES users(id)` to
   `items`, filter by it in the repository, and put `requireRole('admin')` on any
   route that lists across users.
3. **Email verification and password reset** — single-use, hashed, expiring
   tokens, using exactly the pattern the refresh-token sessions already use.
4. **Immediate revocation** — add a `token_version` column on `users`, put it in
   the JWT payload, and compare it per request. Fixes "a disabled account keeps
   working for 15 minutes" and "a role change takes 15 minutes to apply".
5. **Real migrations** — `db/schema.sql` is idempotent by design, which stops being
   enough the moment you need to change a column. Look at `node-pg-migrate` or Knex.
6. **Pagination with cursors** — `LIMIT/OFFSET` slows down on large tables; cursor
   pagination does not.
7. **Logging** — swap the `console.log` request logger for Pino, add request IDs.
8. **Docker** — a `docker-compose.yml` with PostgreSQL makes the setup one command
   and identical on every machine.
9. **OpenAPI docs** — `swagger-ui-express` generates interactive docs straight from
   your Zod schemas, so they can never drift out of date.
10. **Frontend tests** — `client/` has no tests yet. Vitest with
    `@testing-library/react` and jsdom tests the components, and MSW mocks the API
    so the suite needs no server. The client already has the seams for it:
    `request()` is the only place that calls `fetch`.
11. **Serve the built UI from Express** — mount `client/dist` in `app.ts` (see
    [section 3](#3-web-ui-react--vite)) so production is a single process.
12. **React Query / TanStack Query** — caching, background refetching and
    optimistic updates. Worth it once the list starts paginating over real data;
    overkill for the `useItems` hook as written.
