# Aviatrix Live Connection — Customer Setup Guide

DCF Visualizer can connect directly to your Aviatrix Controller via its MCP server and import your live topology — SmartGroups, WebGroups, ThreatGroups, GeoGroups, and policies — in one click. This document walks through what your Controller admin needs to configure once, and what each user does the first time they connect.

---

## What it does

When connected, the Visualizer can fetch a snapshot of your Controller's DCF configuration on demand. Because the data comes through MCP rather than Terraform export, **server-assigned UUIDs flow through correctly** — so policies that reference SmartGroups or WebGroups by UUID link up automatically (which is impossible with `.tf` files alone, since UUIDs only live in `.tfstate`).

The connection is **read-only** in this release. The Visualizer never writes back to the Controller.

---

## One-time Controller setup (admin)

Your Controller admin needs to register the Visualizer as an OAuth client. Exact UI steps depend on your Controller version; the values you provide are:

| Field | Value |
|---|---|
| **Client name** | Anything memorable, e.g. `DCF Visualizer` |
| **Grant type** | **Authorization Code with PKCE** (no client secret — Visualizer is a public SPA) |
| **Redirect URI** | `https://dcf-visualizer.vercel.app/auth/aviatrix/callback.html` (exact, including the `.html`) |
| **Scopes** | Whatever your MCP server requires for read access (commonly `mcp:read` or similar — confirm with your Aviatrix contact) |

The Controller will issue a **Client ID**. Note it down along with:

- The Controller's **MCP base URL** (e.g. `https://controller.your-company.com/mcp`)
- The OAuth **authorize endpoint** (e.g. `https://controller.your-company.com/oauth/authorize`)
- The OAuth **token endpoint** (e.g. `https://controller.your-company.com/oauth/token`)

Hand those four values to the user (Client ID, MCP base URL, authorize endpoint, token endpoint) — plus the scope string if non-default.

---

## Per-user connection setup

1. Open https://dcf-visualizer.vercel.app
2. Click the **Settings** button (Bot icon in the top-right corner of the header).
3. Scroll down to the **Aviatrix Live Connection** section.
4. Click **Configure** (or **New connection** if you've added one before).
5. Fill the form:
   - **Name** — a label only you see, e.g. "Prod Controller"
   - **MCP base URL** — from the admin
   - **OAuth authorize endpoint** — from the admin
   - **OAuth token endpoint** — from the admin
   - **Client ID** — from the admin
   - **Scope** — from the admin (often `mcp:read`)
6. Click **Save**.
7. On the connection row, click **Connect**.
8. The browser navigates to your Controller's login page. Authenticate as you normally would.
9. After login, the Controller redirects back to the Visualizer. You should see a brief "Connecting…" page and then land back on the Visualizer with the connection marked **Connected**.

That's it. Reconnecting later only requires step 7 (Connect) unless your refresh token has been revoked.

---

## Fetching live topology

1. Click the **Import** icon in the header (or use the existing Import flow).
2. Switch to the **Aviatrix Live** tab.
3. You should see your configured connection with status **Connected**.
4. Click **Fetch from Controller**.
5. Wait a few seconds; a preview of what was fetched appears.
6. Click **Import & Replace** to apply it to your local topology.

The fetched topology replaces your current local one. (If you want to keep your local edits, use the cloud-save feature first.)

---

## What gets imported

| Aviatrix concept | Visualizer concept | Notes |
|---|---|---|
| SmartGroups | SmartGroups | Tag-based selectors land as per-tag VM criteria (more faithful than HCL import). |
| WebGroups | WebGroups | `snifilter` + `urlfilter` patterns flatten into the `fqdns` array. |
| ThreatGroups | ThreatGroups | Names + entry counts. |
| GeoGroups | GeoGroups | Names + country lists. |
| DCF Policies | Policies | UUIDs from the Controller are preserved, so policy→WebGroup and policy→SmartGroup links resolve correctly. |

Anything the Visualizer doesn't currently model is dropped silently. The fetch result tells you how many entries (if any) couldn't be mapped.

---

## Security & privacy

- **Credentials** (your access token + refresh token) are encrypted at rest in your browser's localStorage with AES-GCM. They never leave your browser **except** during the brief code-exchange and refresh calls through `/api/aviatrix/oauth-token`, which forwards directly to your Controller and **does not log tokens**.
- **MCP calls** flow through `/api/aviatrix/topology`, which is a stateless server-side proxy required because browsers can't CORS-call your private Controller directly. It does not store or log your topology data.
- **No write-back.** This release is read-only.
- The OAuth flow uses **PKCE without a client secret** — appropriate for a public SPA. There is no shared secret between the Visualizer and your Controller.

---

## Troubleshooting

**"OAuth provider returned an error: redirect_uri_mismatch"** — The redirect URI on the Controller doesn't exactly match `https://dcf-visualizer.vercel.app/auth/aviatrix/callback.html`. Note the `.html` extension. Update the Controller's OAuth client config.

**"No pending auth flow found in this browser session"** — You opened the callback URL directly, or you closed and reopened the tab between clicking Connect and the redirect-back. Click Connect again from the Visualizer.

**"State mismatch — possible CSRF"** — Same fix as above. Click Connect again.

**"Token endpoint did not respond within the timeout"** — Your Controller's token endpoint is slow or unreachable from Vercel's egress. Check that the endpoint is publicly reachable and not behind an IP allowlist that excludes Vercel.

**Status badge says "Expired"** — Your access token has timed out. Click **Connect** again to refresh. (Automatic token refresh is on the roadmap for the next release.)

**"No MCP tool matched expected pattern for X"** in fetch warnings — Your Controller's MCP server names its list tools differently than the regex expected. Send the warning text to your Aviatrix contact so they can either rename the tool or have the Visualizer's regex updated.

**"Could not reach the token-exchange proxy"** — Visualizer's backend is unreachable. Check https://dcf-visualizer.vercel.app loads at all; if not, the deployment may be down.

---

## Known limitations (this release)

- **Read-only.** No create/update/delete back to the Controller from the Visualizer.
- **No automatic token refresh.** When the access token expires, you re-click Connect. (Refresh-token wiring is the next priority.)
- **MCP tool name discovery is regex-based.** If your Controller uses non-standard tool names, the Visualizer will surface that in the fetch warnings; we may need to adjust the regex.
- **Private-network Controllers.** Vercel's serverless functions run from public AWS IPs. If your Controller is on a private network reachable only from your VPC, this connector won't reach it. A self-hosted variant of the proxy is on the roadmap.
- **Single active connection at a time.** Multi-connection support is in the data model but not exposed in the UI yet.

---

## Questions / issues

File against the repo issue tracker, or contact your Aviatrix solutions team. Include the fetch warnings (visible in the Import → Aviatrix Live tab after a failed fetch) and the browser console log if a network error is involved.
