# Diagrams

Mermaid source lives in [`mmd/`](mmd/); rendered SVGs live in [`img/`](img/). Regenerate after editing a `.mmd` file:

```bash
npx @mermaid-js/mermaid-cli -i docs/mmd/<name>.mmd -o docs/img/<name>.svg -b transparent
```

| Diagram | Description |
|---|---|
| [`architecture.mmd`](mmd/architecture.mmd) / [`.svg`](img/architecture.svg) | Component diagram, one level more detailed than the system overview below: client → Express router (`/v1`) → controllers → services → repositories → PostgreSQL/Redis |
| [`deployment.mmd`](mmd/deployment.mmd) / [`.svg`](img/deployment.svg) | Docker Compose topology: the one-shot `migrate` container, the app, PostgreSQL and Redis, their volumes, health-gated start order, and loopback-only ports |
| [`er-diagram.mmd`](mmd/er-diagram.mmd) / [`.svg`](img/er-diagram.svg) | `users` table schema |
| [`sequence-create-user.mmd`](mmd/sequence-create-user.mmd) / [`.svg`](img/sequence-create-user.svg) | `POST /v1/users` — happy path, validation failure (400), duplicate username or email (409) |
| [`sequence-login.mmd`](mmd/sequence-login.mmd) / [`.svg`](img/sequence-login.svg) | `POST /v1/login` — happy path (access + refresh token issuance, session write), missing fields (400), failed-login backoff (429), invalid credentials (401, constant-time) |
| [`sequence-refresh.mmd`](mmd/sequence-refresh.mmd) / [`.svg`](img/sequence-refresh.svg) | `POST /v1/auth/refresh` — atomic rotation, role re-read, concurrent refresh (409), reuse detection, absolute lifetime |
| [`sequence-get-profile.mmd`](mmd/sequence-get-profile.mmd) / [`.svg`](img/sequence-get-profile.svg) | `GET /v1/users/me` — auth + session check, cache hit, cache miss with PostgreSQL fallback, not found (404) |

Where they're embedded: [`system-overview.svg`](#system-overview-hand-built-svg) in the main [README](../README.md), the sequence diagrams in [api.md](api.md), the ER diagram in [architecture.md](architecture.md), and `deployment.svg` is linked from the README.

## System overview (hand-built SVG)

[`src/system-overview.html`](src/system-overview.html) / [`.svg`](img/system-overview.svg) is a single-page, big-picture view of the whole system — edge middleware, the controller/service/repository fan-out, PostgreSQL and Redis, and the unversioned infra endpoints — kept as hand-positioned SVG (not Mermaid) so its layout stays under direct control. Edit the `<svg>` inside the `.html` file, then re-extract and re-render:

```bash
python3 -c "
import re
html = open('docs/src/system-overview.html').read()
svg = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n' + re.search(r'(<svg.*?</svg>)', html, re.DOTALL).group(1)
open('docs/img/system-overview.svg', 'w').write(svg)
"
```

To sanity-check the layout (text overflow, overlapping boxes) before committing, render it to a PNG with a headless browser and inspect it:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --screenshot=/tmp/system-overview-check.png --window-size=1600,1600 \
  --default-background-color=FFFFFFFF "file://$(pwd)/docs/src/system-overview.html"
```
