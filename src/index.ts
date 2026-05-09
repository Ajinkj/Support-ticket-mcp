import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { firebaseApi, initFirebase } from "./firebase";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { verifyFirebaseToken, signStatelessToken, verifyStatelessToken, verifyCodeChallenge } from "./auth";
// @ts-ignore
import loginHtml from "./login.html" with { type: "text" };

function createMcpServer(userEmail: string = "admin@local") {
  const server = new McpServer({
    name: "support-mcp-server",
    version: "1.0.0",
  });

// Prompt: Provide Support Agent Context
server.prompt(
  "support_agent_instructions",
  "System prompt to set the behavior and context for the Support AI Agent",
  {},
  () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: "You are an expert IT Support and Knowledge Base Agent. Your primary goal is to help users resolve issues, identify root causes, and log investigations accurately. You have access to tools that let you read/write tickets and search the Knowledge Base. Always consult similar tickets or the KB before drawing conclusions. If a solution isn't found, state your observations and hypotheses clearly."
      }
    }]
  })
);

// Tool: Get Ticket Details
server.tool(
  "get_ticket_details",
  "Fetch full details of a specific ticket using its ID.",
  {
    ticketId: z.string().describe("The ID of the ticket to fetch"),
  },
  async ({ ticketId }) => {
    const ticket = await firebaseApi.getTicket(ticketId);
    if (!ticket) {
      return {
        content: [{ type: "text", text: `Ticket with ID ${ticketId} not found.` }]
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }]
    };
  }
);

// Tool: Find Similar Tickets
server.tool(
  "find_similar_tickets",
  "Search for similar resolved tickets based on the new ticket's subject or description to see how they were resolved.",
  {
    query: z.string().describe("Keywords extracted from the ticket subject and description"),
  },
  async ({ query }) => {
    const tickets = await firebaseApi.searchSimilarTickets(query);
    if (tickets.length === 0) {
      return {
        content: [{ type: "text", text: "No similar resolved tickets found." }]
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(tickets, null, 2) }]
    };
  }
);

// Tool: Search Knowledge Base
server.tool(
  "search_knowledge_base",
  "Search the general Knowledge Base for doubts, project info, or documentation.",
  {
    query: z.string().describe("Search query to find relevant KB articles"),
  },
  async ({ query }) => {
    const kbResults = await firebaseApi.searchKB(query);
    if (kbResults.length === 0) {
      return {
        content: [{ type: "text", text: "No relevant Knowledge Base articles found." }]
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(kbResults, null, 2) }]
    };
  }
);

// Tool: Add Investigation Log
server.tool(
  "add_investigation_log",
  "Add a new investigation entry (Hypothesis, Action, Observation, Communication) to a ticket.",
  {
    ticketId: z.string().describe("The ID of the ticket"),
    type: z.string().describe("Type of the entry (e.g., Hypothesis, Action, Observation, Conclusion, Code)"),
    description: z.string().describe("Detailed description of the investigation entry"),
    userId: z.string().describe("The ID of the user or agent making the entry")
  },
  async ({ ticketId, type, description, userId }) => {
    const entry = {
      type,
      description,
      userId,
      timestamp: new Date().toISOString()
    };
    try {
      await firebaseApi.addInvestigationLog(ticketId, entry);
      return {
        content: [{ type: "text", text: "Investigation log added successfully." }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error adding log: ${(error as Error).message}` }],
        isError: true
      };
    }
  }
);

// Tool: Create Ticket
server.tool(
  "create_ticket",
  "Create a new support ticket.",
  {
    title: z.string().describe("The title of the ticket"),
    customerDescription: z.string().optional().describe("Description of the issue from the customer"),
    businessImpact: z.enum(['Low', 'Medium', 'High', 'Critical']).describe("Business impact level"),
    category: z.string().describe("Category of the ticket"),
    ticketNumber: z.string().describe("The ticket ID or ticket Number provided by the user. If they do not provide one, use the ticket subject/title as the ticket ID."),
    supportingLinks: z.array(z.string()).default([]).describe("Any supporting links or references")
  },
  async ({ title, customerDescription, businessImpact, category, ticketNumber, supportingLinks }) => {
    try {
      const ticket = await firebaseApi.createTicket({
        title,
        customerDescription,
        businessImpact,
        category,
        customerEmail: userEmail, // Extracted automatically from the auth token!
        ticketNumber,
        supportingLinks
      });
      return {
        content: [{ type: "text", text: `Ticket created successfully. ID: ${ticket.id}, Ticket Number: ${ticket.ticketNumber}` }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error creating ticket: ${(error as Error).message}` }],
        isError: true
      };
    }
  }
);

// Tool: Create KB Entry
server.tool(
  "create_kb_data",
  "Create a new entry in the Knowledge Base.",
  {
    subject: z.string().describe("Subject of the KB entry"),
    content: z.string().describe("Content or details of the knowledge"),
    resolution: z.string().optional().describe("Resolution or steps to fix (if applicable)"),
    tags: z.array(z.string()).default([]).describe("List of tags for categorization")
  },
  async ({ subject, content, resolution, tags }) => {
    try {
      const kb = await firebaseApi.createKBEntry({
        subject,
        content,
        resolution,
        tags
      });
      return {
        content: [{ type: "text", text: `KB entry created successfully. ID: ${kb.id}` }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error creating KB entry: ${(error as Error).message}` }],
        isError: true
      };
    }
  }
);

// Tool: List All Tickets
server.tool(
  "list_all_tickets",
  "Fetch a list of all tickets including their IDs, subjects, and descriptions.",
  {},
  async () => {
    try {
      const tickets = await firebaseApi.listAllTickets();
      if (tickets.length === 0) {
        return {
          content: [{ type: "text", text: "No tickets found." }]
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(tickets, null, 2) }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error listing tickets: ${(error as Error).message}` }],
        isError: true
      };
    }
  }
);

  return server;
}

const app = new Hono<{ 
  Bindings: { 
    ADMIN_KEY?: string; 
    FIREBASE_PROJECT_ID?: string; 
    FIREBASE_API_KEY?: string; 
    FIREBASE_AUTH_DOMAIN?: string 
  };
  Variables: {
    userEmail: string;
  }
}>();

// Enable CORS for Claude.ai web client
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
  exposeHeaders: ['Mcp-Session-Id'],
  allowMethods: ['GET', 'POST', 'OPTIONS']
}));

// ----------------------------------------------------
// OAuth 2.1 Endpoints for Claude Desktop Integration
// ----------------------------------------------------

app.get('/.well-known/oauth-authorization-server', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"]
  });
});

app.get('/authorize', (c) => {
  // Serve the HTML page, injecting the Firebase config from env
  const html = loginHtml
    .replace('FIREBASE_API_KEY_PLACEHOLDER', c.env.FIREBASE_API_KEY || '')
    .replace('FIREBASE_AUTH_DOMAIN_PLACEHOLDER', c.env.FIREBASE_AUTH_DOMAIN || '')
    .replace('FIREBASE_PROJECT_ID_PLACEHOLDER', c.env.FIREBASE_PROJECT_ID || '');
    
  return c.html(html);
});

app.post('/api/generate-code', async (c) => {
  try {
    const { idToken, redirect_uri, state, code_challenge } = await c.req.json();
    
    // Verify Firebase Token
    const payload = await verifyFirebaseToken(idToken, c.env.FIREBASE_PROJECT_ID!);
    
    // Generate stateless auth code containing user email and PKCE challenge
    const adminKey = c.env.ADMIN_KEY || 'default-secret';
    const authCode = await signStatelessToken({
      email: payload.email,
      sub: payload.sub,
      code_challenge
    }, adminKey, '10m'); // Short-lived code
    
    // Redirect back to Claude Desktop with the code
    const redirectUrl = `${redirect_uri}?code=${authCode}&state=${state}`;
    return c.json({ redirectUrl });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/token', async (c) => {
  const body = await c.req.parseBody();
  const code = body['code'] as string;
  const code_verifier = body['code_verifier'] as string;
  
  if (!code || !code_verifier) return c.json({ error: 'Missing code or verifier' }, 400);
  
  const adminKey = c.env.ADMIN_KEY || 'default-secret';
  
  try {
    const payload = await verifyStatelessToken(code, adminKey);
    
    // Verify PKCE Challenge
    const isValid = await verifyCodeChallenge(code_verifier, payload.code_challenge as string);
    if (!isValid) return c.json({ error: 'Invalid PKCE verifier' }, 400);
    
    // Issue final Access Token
    const accessToken = await signStatelessToken({
      email: payload.email,
      sub: payload.sub
    }, adminKey, '30d');
    
    return c.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 30 * 24 * 60 * 60
    });
  } catch (error) {
    return c.json({ error: 'Invalid or expired code' }, 400);
  }
});

// ----------------------------------------------------
// MCP Server Endpoint
// ----------------------------------------------------

// Advanced Auth Middleware (API Key or Stateless JWT)
app.use('/mcp/*', async (c, next) => {
  const ADMIN_KEY = c.env.ADMIN_KEY || 'default-secret';
  
  const authHeader = c.req.header('Authorization');
  const urlKey = new URL(c.req.url).searchParams.get('key');
  
  // 1. Direct API Key check (for local testing without OAuth)
  if (urlKey === ADMIN_KEY || authHeader === `Bearer ${ADMIN_KEY}`) {
    c.set('userEmail', 'admin@local');
    await next();
    return;
  }
  
  // 2. OAuth Stateless Token verification
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    try {
      const payload = await verifyStatelessToken(token, ADMIN_KEY);
      c.set('userEmail', payload.email as string);
      await next();
      return;
    } catch (e) {
      c.header('WWW-Authenticate', `Bearer resource_metadata="${new URL(c.req.url).origin}/.well-known/oauth-authorization-server"`);
      return c.json({ error: "Invalid OAuth token." }, 401);
    }
  }
  
  c.header('WWW-Authenticate', `Bearer resource_metadata="${new URL(c.req.url).origin}/.well-known/oauth-authorization-server"`);
  return c.json({ error: "Unauthorized. Please authenticate." }, 401);
});

// MCP endpoint
app.all('/mcp/*', async (c) => {
  initFirebase(c.env as any);
  
  const userEmail = c.get('userEmail') as string;
  const server = createMcpServer(userEmail);
  
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  
  await server.connect(transport);
  
  const response = await transport.handleRequest(c.req.raw);
  
  // Transport handles its own lifecycle in stateless mode per request
  return response;
});

export default app;
