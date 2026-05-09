# Learning Document: Architecture & Authentication

This document explains the technical decisions behind the Support MCP Server, specifically focusing on Cloudflare Workers concurrency, Stateful vs Stateless design, and the custom OAuth implementation.

---

## 1. Cloudflare Workers & Concurrency Issues

### The Problem (`Already connected to a transport`)
When we initially built the server, we created a single, global `McpServer` and `WebStandardStreamableHTTPServerTransport` instance. 

Cloudflare Workers run in a specialized V8 isolate environment. Unlike traditional Node.js servers (where each connection might get its own process/thread or stable WebSocket), Cloudflare Workers are heavily optimized to spin up, handle an HTTP request, and immediately spin down. 
When multiple HTTP requests hit the worker (e.g., Claude sending multiple commands), the same global isolate might be reused. Because the transport was global, the second request tried to connect to a transport that was already "locked" by the first request, causing the `Already connected to a transport` or `Conflict` error.

### Stateful vs. Stateless Architecture
- **Stateful (SSE/WebSockets)**: 
  - *Advantages*: Extremely fast for continuous bidirectional communication. The server remembers the client.
  - *Disadvantages*: Hard to scale on edge networks like Cloudflare. If the connection drops or the worker isolate is killed to save memory, the state is lost. You need complex backing stores (like Durable Objects or Redis) to maintain state across reconnects.
  - *When to use*: Chat apps, live multiplayer games, or servers running on dedicated VMs (like AWS EC2 or local Node servers).

- **Stateless (HTTP)**:
  - *Advantages*: Infinitely scalable. Every single request contains all the information needed to process it. If a worker dies, another one immediately handles the next request without any errors.
  - *Disadvantages*: Slight overhead since the client must re-authenticate and establish context with every single request.
  - *When to use*: Serverless environments, REST APIs, Cloudflare Workers, AWS Lambda.

**Our Solution**: We switched the MCP transport to pure Stateless mode (`sessionIdGenerator: undefined`) and moved the `McpServer` creation inside the request handler. Now, every single HTTP request gets a brand new, isolated server. It processes the message, returns the response, and disappears cleanly.

---

## 2. OAuth 2.1 & Wrapping Firebase Auth

### What is OAuth?
OAuth (Open Authorization) is an open standard for access delegation. Instead of giving Claude Desktop your actual email and password, OAuth allows you to log in to an Identity Provider (like Google or Firebase), which then issues a temporary "Access Token". Claude uses this token to access your MCP server.

### Wrapping Firebase Auth
Firebase Authentication provides a great UI for users (Email/Password, Google Sign-In) but it outputs a *Firebase ID Token*. Claude Desktop doesn't natively know what a Firebase ID token is—it expects a standard OAuth server.

We built an **OAuth Wrapper**:
1. Claude Desktop requests an OAuth login (`GET /authorize`).
2. We serve a webpage showing the Firebase Login UI.
3. The user logs in, and the webpage sends the Firebase Token to our Worker (`POST /api/generate-code`).
4. The Worker validates the Firebase Token and acts as the "Identity Provider", issuing a standard OAuth authorization code.

---

## 3. Stateless JWT Token Handling (No Database Needed)

In a traditional OAuth server, when the user logs in, the server generates a random string (e.g., `code=12345`) and saves it in a database (`12345 maps to user@example.com`). When the client exchanges the code for a token, the server checks the database.

However, databases at the edge (like Cloudflare KV) add complexity and latency.

**Stateless JWTs to the Rescue**:
Instead of a random string, our authorization `code` is actually a **Signed JSON Web Token (JWT)**.
- When the user logs in, the Worker creates a JSON payload: `{"email": "user@example.com", "exp": 17000000}`.
- It cryptographically signs this payload using your secret `ADMIN_KEY`.
- It gives this signed JWT to the client as the `code`.

When Claude Desktop sends the code back (`POST /token`), the Worker doesn't look in a database. It simply checks the cryptographic signature using the `ADMIN_KEY`. If the signature matches, the Worker *knows* nobody tampered with the payload, and it trusts the `email` inside it!

This allows the entire OAuth flow to happen securely at the edge without a single database read/write!

---

## 4. Claude.ai Web Connector & Common OAuth Pitfalls

When connecting this MCP Server directly to the **Claude.ai Web UI** via the Custom Connector (Beta), we encountered three critical edge cases that caused "Server Unreachable" errors. Here is how we solved them:

### A. CORS (Cross-Origin Resource Sharing)
Because Claude.ai is a web application running in your browser, it makes a direct `fetch()` request to `your-subdomain.workers.dev`. Browsers block cross-domain requests by default.
- **The Fix**: We added the `hono/cors` middleware to globally inject headers like `Access-Control-Allow-Origin: *` and expose MCP-specific headers (`Mcp-Session-Id`), allowing the Claude.ai frontend to communicate directly with our edge server.

### B. The `WWW-Authenticate` Header
When Claude.ai attempts an initial connection without a token, the MCP server returns a `401 Unauthorized` status. However, according to the MCP specification, returning a generic `401` is not enough—the client will assume the server is broken.
- **The Fix**: The server MUST return a specific header alongside the `401` status:
  `WWW-Authenticate: Bearer resource_metadata="https://your-server.com/.well-known/oauth-authorization-server"`
  This header officially signals to Claude that this is an OAuth challenge, pointing it to the `.well-known` configuration document so it knows where the `/authorize` endpoint lives.

### C. Forcing the OAuth Flow in the UI
Even with the headers fixed, if the "OAuth Client ID" and "OAuth Client Secret" fields are left blank in the Claude.ai connection settings (since the UI marks them as "optional"), Claude may attempt to bypass OAuth entirely.
- **The Fix**: Because our stateless OAuth JWT design cryptographically verifies tokens instead of checking a strict database of client secrets, we can pass **dummy values** (e.g., `client_id: claude`, `secret: secret`) in the Claude UI. Supplying these values forces the Claude web client to initiate the OAuth flow and correctly open our Firebase login page!
