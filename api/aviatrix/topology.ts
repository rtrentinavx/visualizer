import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithTimeout, isTimeoutError } from '../ai/_timeout';

/**
 * MCP client proxy for live topology fetch from a customer's Aviatrix
 * Controller. Speaks Streamable-HTTP MCP (JSON-RPC 2.0 over a single POST
 * endpoint), accepts either JSON or SSE responses from upstream, and
 * aggregates the result of five "list" tool calls into one payload the
 * mapping layer can consume.
 *
 * Request:
 *   { baseUrl, accessToken }
 *
 * Response:
 *   {
 *     raw: {
 *       smartGroups: unknown[],
 *       webGroups: unknown[],
 *       threatGroups: unknown[],
 *       geoGroups: unknown[],
 *       policies: unknown[],
 *     },
 *     toolNames: Record<EntityKey, string>,  // which tool we actually called
 *     warnings: string[],                    // entities with no matching tool
 *   }
 *
 * Wire-format assumptions (will adjust during the first real test):
 * - The MCP server requires an `initialize` handshake before tools/list.
 * - Session correlation is via `Mcp-Session-Id` response header.
 * - Tool results put usable data in result.structuredContent (preferred) or
 *   result.content[0].text as a JSON string (fallback).
 * - Tool names match /list[_-]?(smart|web|threat|geo)[_-]?groups/ or
 *   /list[_-]?policies/ case-insensitively. If your server uses different
 *   names, this layer surfaces them in `warnings` so we can tweak quickly.
 */

export const config = { maxDuration: 60 };

type EntityKey = 'smartGroups' | 'webGroups' | 'threatGroups' | 'geoGroups' | 'policies';

const ENTITY_TOOL_PATTERNS: Record<EntityKey, RegExp> = {
  smartGroups: /(list|get|fetch|read)[_-]?smart[_-]?groups?/i,
  webGroups: /(list|get|fetch|read)[_-]?web[_-]?groups?/i,
  threatGroups: /(list|get|fetch|read)[_-]?threat[_-]?groups?/i,
  geoGroups: /(list|get|fetch|read)[_-]?geo[_-]?groups?/i,
  policies: /(list|get|fetch|read)[_-]?(dcf[_-]?)?polic(y|ies)/i,
};

interface FetchTopologyRequest {
  baseUrl: string;
  accessToken: string;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolListResult {
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
}

interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body must be JSON.' });
    }
    const { baseUrl, accessToken } = req.body as FetchTopologyRequest;
    if (!baseUrl || !accessToken) {
      return res.status(400).json({ error: 'Missing baseUrl or accessToken.' });
    }
    if (!isHttpUrl(baseUrl)) {
      return res.status(400).json({ error: 'baseUrl must be an http(s) URL.' });
    }

    const client = new McpClient(baseUrl, accessToken);

    try {
      // 1) Initialize the MCP session.
      await client.initialize();

      // 2) Discover the available tools and match them to our entity keys.
      const tools = await client.listTools();
      const toolNames: Partial<Record<EntityKey, string>> = {};
      const warnings: string[] = [];

      for (const key of Object.keys(ENTITY_TOOL_PATTERNS) as EntityKey[]) {
        const re = ENTITY_TOOL_PATTERNS[key];
        const match = tools.find((t) => re.test(t.name));
        if (match) toolNames[key] = match.name;
        else warnings.push(`No MCP tool matched expected pattern for "${key}". Server exposed: ${tools.map((t) => t.name).join(', ') || '(none)'}`);
      }

      // 3) Call each matched tool and collect raw results.
      const raw: Record<EntityKey, unknown[]> = {
        smartGroups: [],
        webGroups: [],
        threatGroups: [],
        geoGroups: [],
        policies: [],
      };

      for (const key of Object.keys(toolNames) as EntityKey[]) {
        const name = toolNames[key];
        if (!name) continue;
        try {
          const data = await client.callTool(name);
          raw[key] = Array.isArray(data) ? data : extractArray(data);
        } catch (err) {
          warnings.push(`Tool "${name}" call failed for "${key}": ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }

      return res.status(200).json({ raw, toolNames, warnings });
    } catch (err) {
      if (isTimeoutError(err)) {
        return res.status(504).json({ error: 'MCP endpoint did not respond within the timeout.' });
      }
      const message = err instanceof Error ? err.message : 'MCP call failed.';
      console.error('[aviatrix/topology] upstream error', err);
      return res.status(502).json({ error: message });
    }
  } catch (err) {
    console.error('[aviatrix/topology] outer error', err);
    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: `Proxy error: ${message}` });
    }
  }
}

/**
 * Minimal Streamable-HTTP MCP client. One instance = one session. Maintains
 * the Mcp-Session-Id header and an incrementing request id. Accepts both
 * application/json and text/event-stream responses transparently.
 */
class McpClient {
  private nextId = 1;
  private sessionId: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async initialize(): Promise<unknown> {
    const result = await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'dcf-visualizer', version: '1.0.0' },
    });
    return result;
  }

  async listTools(): Promise<ToolListResult['tools']> {
    const result = (await this.request('tools/list', {})) as ToolListResult;
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const result = (await this.request('tools/call', { name, arguments: args })) as ToolCallResult;
    if (result.isError) {
      const txt = result.content?.find((c) => c.type === 'text')?.text ?? 'unknown error';
      throw new Error(`Tool ${name} returned isError: ${txt}`);
    }
    // Prefer the structured representation; fall back to parsing the first text block as JSON.
    if (result.structuredContent !== undefined) return result.structuredContent;
    const text = result.content?.find((c) => c.type === 'text')?.text;
    if (text) {
      try { return JSON.parse(text); } catch { return text; }
    }
    return null;
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const upstream = await fetchWithTimeout(this.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });

    // Save session id from the initialize response (or any later response that
    // sets one — some servers rotate it).
    const newSession = upstream.headers.get('Mcp-Session-Id');
    if (newSession) this.sessionId = newSession;

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      throw new Error(`MCP ${method} HTTP ${upstream.status}: ${text.slice(0, 500)}`);
    }

    const contentType = upstream.headers.get('Content-Type') || '';
    const payload: JsonRpcResponse = contentType.includes('text/event-stream')
      ? await parseSseForJsonRpc(upstream)
      : (await upstream.json()) as JsonRpcResponse;

    if (payload.error) {
      throw new Error(`MCP ${method} JSON-RPC error: ${payload.error.message}`);
    }
    return payload.result;
  }
}

/**
 * Drain an SSE stream until we see a JSON-RPC response (an event whose data
 * line parses as `{ jsonrpc: "2.0", id, result|error }`). Returns the first
 * such payload, or throws if the stream ends without one.
 */
async function parseSseForJsonRpc(response: Response): Promise<JsonRpcResponse> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SSE response has no body.');
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on double-newline to get complete SSE events.
      let sep = buffer.indexOf('\n\n');
      while (sep >= 0) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseSseEvent(event);
        if (parsed) return parsed;
        sep = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error('SSE stream ended without a JSON-RPC response.');
}

function parseSseEvent(event: string): JsonRpcResponse | null {
  // Collect all `data:` lines (SSE allows multi-line data values).
  const dataLines: string[] = [];
  for (const line of event.split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    const obj = JSON.parse(dataLines.join('\n')) as JsonRpcResponse;
    if (obj.jsonrpc === '2.0' && (obj.result !== undefined || obj.error !== undefined)) {
      return obj;
    }
  } catch {
    // Non-JSON-RPC event (e.g. notifications). Skip.
  }
  return null;
}

/**
 * Pull a list of items out of an opaque tool response. MCP tools that "list
 * X" typically return either an array, or an object with one of the common
 * wrapper keys (items, data, results, <entity>). This is best-effort — if
 * the actual shape is something else, the mapping layer will see `[]` and
 * the caller can adjust.
 */
function extractArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const k of ['items', 'data', 'results', 'value', 'list']) {
      if (Array.isArray(obj[k])) return obj[k] as unknown[];
    }
    // Last resort: the first array-valued field.
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
