# Support MCP Server

This is an MCP (Model Context Protocol) Server for the IT Support and Knowledge Base management agent. It is designed to be hosted on Cloudflare Workers and interfaces with a Firebase Firestore database.

## Prerequisites
- Node.js installed
- Cloudflare Wrangler CLI (`npm i -g wrangler`)
- Claude Desktop installed

## Features
- **Get Ticket Details**: Retrieves all details about a support ticket using its ID.
- **Find Similar Tickets**: Searches for resolved tickets based on extracted keywords.
- **Search Knowledge Base**: Searches the KB for known issues or documentation.
- **Add Investigation Log**: Appends a new hypothesis or observation log to a ticket.

## Local Testing with MCP Inspector

To start the MCP server locally for testing:
1. First, create a `.dev.vars` file in the root of the `support-mcp-server` directory to define your local `ADMIN_KEY`:
   ```env
   ADMIN_KEY=local-secret-key
   ```
2. Install dependencies and run the development server:
   ```bash
   npm install
   npx wrangler dev
   ```
   The server will start running locally on port `8787` (e.g., `http://localhost:8787`).

3. In a new terminal window, start the official MCP Inspector:
   ```bash
   npx @modelcontextprotocol/inspector@latest
   ```
   This will open a browser window for the Inspector.

4. **Connecting the Inspector**:
   In the Inspector dashboard, you'll need to enter your MCP Server URL. Since we added simple authentication, you must pass the key in the URL as a query parameter.
   - **URL:** `http://localhost:8787/mcp?key=local-secret-key`
   
   Click "Connect". The Inspector will authenticate using the key, connect to your local Cloudflare Worker, and list the available tools (`get_ticket_details`, `find_similar_tickets`, etc.).

## How Authentication is Implemented (Learning Docs)

The simple authentication mechanism acts as a gatekeeper to the MCP server. Here is how it is implemented inside `src/index.ts`:

1. **Environment Variables**: We define an `ADMIN_KEY` in the Cloudflare environment variables (or `.dev.vars` locally).
2. **Hono Middleware**: We use a `Hono` router middleware that intercepts every request sent to the `/mcp/*` endpoint.
   ```typescript
   app.use('/mcp/*', async (c, next) => {
     const ADMIN_KEY = c.env.ADMIN_KEY;
     
     // We check if the request provides the key either in the Header or Query string
     const authHeader = c.req.header('Authorization');
     const urlKey = new URL(c.req.url).searchParams.get('key');
     
     const isAuthorized = authHeader === `Bearer ${ADMIN_KEY}` || urlKey === ADMIN_KEY;
     
     if (!isAuthorized) {
       return c.json({ error: "Unauthorized." }, 401);
     }
     await next();
   });
   ```
3. **Usage**:
   - For **code/scripts**, you can pass it via headers: `Authorization: Bearer my-super-secret-key`.
   - For tools like **Claude Desktop** or **MCP Inspector** where setting custom HTTP headers might be complex, you can conveniently pass it via the query string: `https://.../mcp?key=my-super-secret-key`.

## Deployment to Cloudflare

Cloudflare Workers require a slightly specific order of operations when you are using Secrets (like our `ADMIN_KEY` or `FIREBASE_API_KEY`). You must deploy the worker first (which creates it in Cloudflare), add your secrets, and then deploy it again so it can pick them up.

1. **Login to Cloudflare**:
   ```bash
   npx wrangler login
   ```

2. **Initial Deployment (Create the Worker)**:
   ```bash
   npx wrangler deploy
   ```
   *(Note: This might temporarily fail to execute its logic properly because the secrets aren't there yet, but it successfully creates the worker project in your Cloudflare account).*

3. **Add Secrets**:
   Now that the worker exists, you can securely add your environment variables. Run the following commands one by one, and paste the corresponding value when prompted:
   ```bash
   npx wrangler secret put ADMIN_KEY
   npx wrangler secret put FIREBASE_API_KEY
   npx wrangler secret put FIREBASE_AUTH_DOMAIN
   npx wrangler secret put FIREBASE_PROJECT_ID
   npx wrangler secret put FIREBASE_STORAGE_BUCKET
   npx wrangler secret put FIREBASE_MESSAGING_SENDER_ID
   npx wrangler secret put FIREBASE_APP_ID
   ```

4. **Redeploy to Apply Secrets**:
   ```bash
   npx wrangler deploy
   ```
   After this deployment, your MCP server will be fully functional and live at a URL like:
   `https://support-mcp.YOUR-SUBDOMAIN.workers.dev/mcp`

## Updating Existing Deployments
Whenever you make changes to the code (like adding new tools or fixing bugs), simply run:
```bash
npx wrangler deploy
```
Cloudflare will automatically package your new code and update the existing live endpoint.

## Claude Desktop Configuration
To use this remote MCP server with Claude Desktop, you need the `mcp-remote` local proxy utility.

1. Open Claude Desktop's configuration file:
   - MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add your MCP server to the configuration:
   ```json
   {
     "mcpServers": {
       "support_agent": {
         "command": "npx",
         "args": [
           "-y",
           "mcp-remote",
           "https://support-mcp.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_ADMIN_KEY"
         ]
       }
     }
   }
   ```
   *(Note: Replace `YOUR-SUBDOMAIN` and `YOUR_ADMIN_KEY` with actual values).*

3. Restart Claude Desktop. It will now have access to your support management tools!
