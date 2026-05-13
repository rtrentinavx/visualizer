import type { DcfPolicyModel, SmartGroup, WebGroup, DcfPolicy, SmartGroupCriteria } from '../types/dcf';

// JSON topology save/import was removed — Terraform HCL (paste + zip upload)
// is the only structured-config import/export path now. Cloud sync (Upstash)
// still serializes the topology as JSON internally, but that's not a user-
// facing import/export surface.

// ---------- Terraform HCL Import (lightweight parser) ----------

interface HclBlock {
  type: string;
  labels: string[];
  attributes: Record<string, unknown>;
  blocks: HclBlock[];
}

function tokenizeHcl(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      if (escape) {
        current += ch;
        escape = false;
        continue;
      }
      if (ch === '\\') {
        current += ch;
        escape = true;
        continue;
      }
      current += ch;
      if (ch === stringChar) {
        inString = false;
        tokens.push(current);
        current = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (current.trim()) {
        tokens.push(current.trim());
      }
      inString = true;
      stringChar = ch;
      current = ch;
      continue;
    }

    if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === '=' || ch === ',') {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      tokens.push(ch);
      continue;
    }

    if (ch === '#' || (ch === '/' && input[i + 1] === '/')) {
      // Skip comment to end of line
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens;
}

function parseValue(tokens: string[], idx: { i: number }): unknown {
  const tok = tokens[idx.i];
  if (!tok) return null;

  if (tok === '[') {
    idx.i++;
    const arr: unknown[] = [];
    while (idx.i < tokens.length && tokens[idx.i] !== ']') {
      if (tokens[idx.i] === ',') {
        idx.i++;
        continue;
      }
      arr.push(parseValue(tokens, idx));
    }
    idx.i++; // skip ]
    return arr;
  }

  if (tok === '{') {
    // Object literal: `attr = { key = value, ... }`. Without this, the `{` would
    // be returned as a string and its matching `}` would orphan, desyncing brace
    // counts and causing the next top-level block to be consumed as garbage.
    idx.i++;
    const obj: Record<string, unknown> = {};
    while (idx.i < tokens.length && tokens[idx.i] !== '}') {
      const cur = tokens[idx.i];
      if (cur === undefined) break;
      if (cur === ',') { idx.i++; continue; }
      if (tokens[idx.i + 1] === '=') {
        idx.i += 2;
        obj[cur] = parseValue(tokens, idx);
      } else {
        idx.i++;
      }
    }
    if (tokens[idx.i] === '}') idx.i++;
    return obj;
  }

  if (tok.startsWith('"') && tok.endsWith('"')) {
    idx.i++;
    return tok.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  if (tok === 'true') { idx.i++; return true; }
  if (tok === 'false') { idx.i++; return false; }

  const num = Number(tok);
  if (!isNaN(num) && tok !== '') { idx.i++; return num; }

  idx.i++;
  return tok;
}

function parseBlock(tokens: string[], idx: { i: number }): HclBlock | null {
  if (idx.i >= tokens.length) return null;

  const type = tokens[idx.i];
  if (!type) return null;
  idx.i++;

  const labels: string[] = [];
  while (idx.i < tokens.length) {
    const t = tokens[idx.i];
    if (t === undefined || t === '{' || !t.startsWith('"') || !t.endsWith('"')) break;
    labels.push(t.slice(1, -1));
    idx.i++;
  }

  if (tokens[idx.i] !== '{') {
    // Not a block, skip ahead
    while (idx.i < tokens.length && tokens[idx.i] !== '{') idx.i++;
  }
  if (tokens[idx.i] !== '{') return null;
  idx.i++; // skip {

  const attributes: Record<string, unknown> = {};
  const blocks: HclBlock[] = [];

  while (idx.i < tokens.length && tokens[idx.i] !== '}') {
    const key = tokens[idx.i];
    if (key === undefined) break;
    if (tokens[idx.i + 1] === '=') {
      idx.i += 2; // skip key and =
      attributes[key] = parseValue(tokens, idx);
    } else if (tokens[idx.i + 1] === '{') {
      const nested = parseBlock(tokens, idx);
      if (nested) blocks.push(nested);
    } else {
      idx.i++;
    }
  }

  if (tokens[idx.i] === '}') idx.i++;

  return { type, labels, attributes, blocks };
}

function parseHcl(input: string): HclBlock[] {
  const tokens = tokenizeHcl(input);
  const blocks: HclBlock[] = [];
  const idx = { i: 0 };
  while (idx.i < tokens.length) {
    const block = parseBlock(tokens, idx);
    if (block) blocks.push(block);
    else idx.i++;
  }
  return blocks;
}

function findBlocks(root: HclBlock[], type: string): HclBlock[] {
  const result: HclBlock[] = [];
  function walk(blocks: HclBlock[]) {
    for (const b of blocks) {
      if (b.type === type) result.push(b);
      walk(b.blocks);
    }
  }
  walk(root);
  return result;
}

function getAttr(block: HclBlock, key: string): unknown {
  return block.attributes[key];
}

function getString(block: HclBlock, key: string): string | undefined {
  const v = getAttr(block, key);
  return typeof v === 'string' ? v : undefined;
}

function getNumber(block: HclBlock, key: string): number | undefined {
  const v = getAttr(block, key);
  return typeof v === 'number' ? v : undefined;
}

function getBool(block: HclBlock, key: string): boolean | undefined {
  const v = getAttr(block, key);
  return typeof v === 'boolean' ? v : undefined;
}

function getStringArray(block: HclBlock, key: string): string[] {
  const v = getAttr(block, key);
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === 'string');
}

function randomColor(): string {
  const colors = ['#3b82f6', '#22c55e', '#ef4444', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#10b981'];
  return colors[Math.floor(Math.random() * colors.length)] ?? '#3b82f6';
}

/**
 * Convert a single `match_expressions { ... }` block into zero or more
 * SmartGroupCriteria entries. Handles the shapes the Aviatrix provider emits:
 *
 *   - { cidr = "..." }                          -> subnet
 *   - { type = "subnet" cidr = "..." }          -> subnet (our export shape)
 *   - { type = "vm" key = "tag:env" val = "..." } -> vm (our export shape)
 *   - { type = "vm" tags = { k = "v", ... } }   -> one vm criterion per pair
 *   - { type = "vpc" name = "kccd-euc" }        -> vm-typed with key="vpc", value=name
 *   - Other resource-type matchers (account, region, k8s_*, etc.) without
 *     a clean key/value mapping are encoded as vm criteria with key="<type>"
 *     and value="<best-effort string>". Unknown shapes are skipped, NOT
 *     pushed as empty criteria — empty criteria mask the bug.
 */
function extractSmartGroupCriteria(me: HclBlock): SmartGroupCriteria[] {
  const out: SmartGroupCriteria[] = [];
  const type = getString(me, 'type');
  const cidr = getString(me, 'cidr');
  const tags = me.attributes['tags'];

  // Subnet: a CIDR is present, regardless of whether `type` was declared.
  if (cidr) {
    out.push({ type: 'subnet', cidr });
    // A match_expressions block typically has either a cidr OR a vm-shaped
    // discriminator, not both. If we already saw a cidr, we're done with this
    // block.
    return out;
  }

  // Tags map: `tags = { k = "v", k2 = "v2" }` produces one vm criterion per pair.
  if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
    for (const [k, v] of Object.entries(tags as Record<string, unknown>)) {
      if (typeof v === 'string') {
        out.push({ type: 'vm', key: k, operator: 'equals', value: v });
      }
    }
    if (out.length > 0) return out;
  }

  // Single key/val (our own export shape): `key = "tag:env" val = "prod"`.
  const key = getString(me, 'key');
  const val = getString(me, 'val') ?? getString(me, 'value');
  if (key || val !== undefined) {
    out.push({
      type: 'vm',
      key: key ? (key.startsWith('tag:') ? key.slice(4) : key) : undefined,
      operator: val !== undefined ? 'equals' : undefined,
      value: val,
    });
    return out;
  }

  // Resource-type matchers: `{ type = "vpc" name = "kccd-euc" }` and similar.
  // We don't have native fields for vpc/account/region/k8s_*; encode the
  // discriminator as a synthetic key+value so the criterion is at least
  // visible and editable in the inspector.
  if (type) {
    const synthValue =
      getString(me, 'name') ??
      getString(me, 'account_name') ??
      getString(me, 'region') ??
      getString(me, 'res_id') ??
      getString(me, 'fqdn');
    if (synthValue !== undefined) {
      out.push({ type: 'vm', key: type, operator: 'equals', value: synthValue });
      return out;
    }
  }

  // Unknown shape — skip rather than push an empty criterion. Empty criteria
  // get the SmartGroup imported with no resolvable membership and mask the bug.
  return out;
}

export function importTerraformHCL(hcl: string): DcfPolicyModel {
  const root = parseHcl(hcl);
  const resources = findBlocks(root, 'resource');

  const smartGroups: SmartGroup[] = [
  ];
  const policies: DcfPolicy[] = [];

  // Map from Terraform resource name to generated group ID
  const nameToId = new Map<string, string>();

  // First pass: Smart Groups
  for (const res of resources) {
    if (res.labels[0] !== 'aviatrix_smart_group') continue;
    const tfName = res.labels[1] || '';
    const name = getString(res, 'name') || tfName;
    const id = `sg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    nameToId.set(tfName, id);

    const criteria: SmartGroupCriteria[] = [];
    const selectors = findBlocks(res.blocks, 'selector');
    for (const sel of selectors) {
      const matchExps = findBlocks(sel.blocks, 'match_expressions');
      for (const me of matchExps) {
        criteria.push(...extractSmartGroupCriteria(me));
      }
    }

    smartGroups.push({
      id,
      name,
      color: randomColor(),
      criteria,
      matchType: selectors.length > 1 ? 'any' : 'all',
    });
  }

  // Second pass: Web Groups (aviatrix_web_group). Each resource has a name and
  // one or more `selector { match_expressions { snifilter|urlfilter|fqdn = "..." } }`
  // blocks. We flatten every match_expressions value into the WebGroup's
  // `fqdns` array — SNI and URL patterns share the same glob shape downstream.
  const webGroups: WebGroup[] = [];
  const webGroupTfNameToId = new Map<string, string>();
  for (const res of resources) {
    if (res.labels[0] !== 'aviatrix_web_group') continue;
    const tfName = res.labels[1] || '';
    const name = getString(res, 'name') || tfName;
    const id = `wg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    webGroupTfNameToId.set(tfName, id);

    const fqdns: string[] = [];
    const selectors = findBlocks(res.blocks, 'selector');
    for (const sel of selectors) {
      const matchExps = findBlocks(sel.blocks, 'match_expressions');
      for (const me of matchExps) {
        // snifilter is the canonical L7 SNI match; urlfilter is the URL-pattern
        // match. Both feed our single `fqdns` list. `fqdn` is a possible alias.
        const sni = getString(me, 'snifilter');
        const url = getString(me, 'urlfilter');
        const fqdn = getString(me, 'fqdn');
        if (sni) fqdns.push(sni);
        if (url) fqdns.push(url);
        if (fqdn) fqdns.push(fqdn);
      }
    }

    webGroups.push({ id, name, fqdns });
  }

  function resolveWebGroupRef(ref: string): string | null {
    // Direct name match against any imported WebGroup
    const byName = webGroups.find((g) => g.name === ref);
    if (byName) return byName.id;
    // Terraform reference: aviatrix_web_group.<tfName>.{name,id,uuid}
    const tfMatch = ref.match(/aviatrix_web_group\.([a-zA-Z0-9_]+)\.(?:name|id|uuid)/);
    if (tfMatch && tfMatch[1]) {
      const wid = webGroupTfNameToId.get(tfMatch[1]);
      if (wid) return wid;
    }
    // Controller-emitted UUID with no matching local resource — can't resolve
    // without .tfstate. Returning null lets the caller silently skip the
    // attachment rather than fail the whole import.
    return null;
  }

  // Helper to resolve group references
  function resolveGroupRef(ref: string): string | null {
    // Direct name match
    const byName = smartGroups.find((g) => g.name === ref);
    if (byName) return byName.id;
    // Terraform reference: aviatrix_smart_group.<name>.name
    const match = ref.match(/aviatrix_smart_group\.([a-zA-Z0-9_]+)\.(?:name|id)/);
    if (match && match[1]) {
      const id = nameToId.get(match[1]);
      if (id) return id;
    }
    // Try matching by sanitized name
    for (const [tfName, gid] of nameToId) {
      if (ref.includes(tfName)) return gid;
    }
    return null;
  }

  // Second pass: Policy Lists
  for (const res of resources) {
    if (res.labels[0] !== 'aviatrix_distributed_firewalling_policy_list') continue;
    const policyBlocks = findBlocks(res.blocks, 'policies');
    for (const pb of policyBlocks) {
      const name = getString(pb, 'name') || 'Imported Policy';
      const priority = getNumber(pb, 'priority') || 100;
      const actionRaw = (getString(pb, 'action') || 'DENY').toLowerCase();
      const action: DcfPolicy['action'] = actionRaw === 'permit' ? 'allow' : actionRaw === 'learned' ? 'learned' : 'deny';
      const protocolRaw = (getString(pb, 'protocol') || 'ANY').toLowerCase();
      const protocol: DcfPolicy['protocol'] =
        protocolRaw === 'tcp' ? 'tcp' : protocolRaw === 'udp' ? 'udp' : protocolRaw === 'icmp' ? 'icmp' : 'any';
      const logging = getBool(pb, 'logging') ?? false;
      const decrypt = getBool(pb, 'decrypt') ?? false;

      // Ports
      let ports: string | undefined;
      const portRanges = getStringArray(pb, 'port_ranges');
      if (portRanges.length > 0) {
        ports = portRanges.join(',');
      }

      // Source / Destination
      const srcRefs = getStringArray(pb, 'src_smart_groups');
      const dstRefs = getStringArray(pb, 'dst_smart_groups');
      const srcId = srcRefs[0] ? (resolveGroupRef(srcRefs[0]) || 'sg-any') : 'sg-any';
      const dstId = dstRefs[0] ? (resolveGroupRef(dstRefs[0]) || 'sg-any') : 'sg-any';

      // Excludes
      const srcExcludeIds: string[] = [];
      const dstExcludeIds: string[] = [];
      const srcExcludeRefs = getStringArray(pb, 'src_exclude_smart_groups');
      const dstExcludeRefs = getStringArray(pb, 'dst_exclude_smart_groups');
      for (const ref of srcExcludeRefs) {
        const resolved = resolveGroupRef(ref);
        if (resolved) srcExcludeIds.push(resolved);
      }
      for (const ref of dstExcludeRefs) {
        const resolved = resolveGroupRef(ref);
        if (resolved) dstExcludeIds.push(resolved);
      }

      // WebGroups attached to this policy — try Terraform-ref + name match.
      // UUID-only references from controller-emitted Terraform can't resolve
      // here (we have no .tfstate); those entries are silently skipped.
      const webGroupIds: string[] = [];
      const webGroupRefs = getStringArray(pb, 'web_groups');
      for (const ref of webGroupRefs) {
        const resolved = resolveWebGroupRef(ref);
        if (resolved) webGroupIds.push(resolved);
      }

      policies.push({
        id: `pol-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        priority,
        srcGroupId: srcId,
        dstGroupId: dstId,
        srcExcludeGroupIds: srcExcludeIds.length > 0 ? srcExcludeIds : undefined,
        dstExcludeGroupIds: dstExcludeIds.length > 0 ? dstExcludeIds : undefined,
        webGroupIds: webGroupIds.length > 0 ? webGroupIds : undefined,
        action,
        protocol,
        ports,
        logging,
        decrypt,
      });
    }
  }

  return {
    smartGroups,
    webGroups,
    threatGroups: [],
    geoGroups: [],
    policies,
    flows: [],
  };
}


// ---------- Traffic Flow Import / Export ----------

import type { TrafficFlow } from '../types/dcf';

export function exportFlowsJSON(flows: TrafficFlow[]): string {
  return JSON.stringify(flows, null, 2);
}

export function downloadFlowsJSON(flows: TrafficFlow[]): void {
  const content = exportFlowsJSON(flows);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dcf-flows.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportFlowsCSV(flows: TrafficFlow[], topology: DcfPolicyModel): string {
  const headers = ['timestamp', 'src_group', 'dst_group', 'protocol', 'port', 'bytes', 'packets', 'allowed'];
  const rows = flows.map((f) => {
    const src = topology.smartGroups.find((g) => g.id === f.srcGroupId)?.name || f.srcGroupId;
    const dst = topology.smartGroups.find((g) => g.id === f.dstGroupId)?.name || f.dstGroupId;
    return [f.timestamp, src, dst, f.protocol, f.port, f.bytes, f.packets, f.allowed].join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

export function downloadFlowsCSV(flows: TrafficFlow[], topology: DcfPolicyModel): void {
  const content = exportFlowsCSV(flows, topology);
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dcf-flows.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importFlowsJSON(json: string): TrafficFlow[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('Expected an array of flows');
  return parsed.map((f, i) => ({
    id: f.id || `flow-${Date.now()}-${i}`,
    srcGroupId: f.srcGroupId || 'sg-any',
    dstGroupId: f.dstGroupId || 'sg-any',
    protocol: f.protocol || 'tcp',
    port: Number(f.port) || 0,
    bytes: Number(f.bytes) || 0,
    packets: Number(f.packets) || 0,
    allowed: Boolean(f.allowed),
    timestamp: f.timestamp || new Date().toISOString(),
  }));
}

export function importFlowsCSV(csv: string): TrafficFlow[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1);

  const getIndex = (name: string) => headers.findIndex((h) => h.includes(name));
  const srcIdx = getIndex('src');
  const dstIdx = getIndex('dst');
  const protoIdx = getIndex('protocol');
  const portIdx = getIndex('port');
  const bytesIdx = getIndex('bytes');
  const pktsIdx = getIndex('packet');
  const allowedIdx = getIndex('allowed');
  const tsIdx = getIndex('timestamp');

  // Bug-fix: if a CSV row is short of expected columns, `cols[i]` is undefined.
  // Previously this silently produced `srcGroupId: undefined` / `allowed: false`
  // (and a TypeError on `.toLowerCase()` of undefined). Fall back per-field.
  const col = (cols: string[], i: number, fallback: string): string =>
    i >= 0 ? (cols[i] ?? fallback) : fallback;

  return rows.map((row, i) => {
    const cols = row.split(',').map((c) => c.trim());
    const allowedStr = col(cols, allowedIdx, '').toLowerCase();
    return {
      id: `flow-${Date.now()}-${i}`,
      srcGroupId: col(cols, srcIdx, 'sg-any'),
      dstGroupId: col(cols, dstIdx, 'sg-any'),
      protocol: col(cols, protoIdx, 'tcp') as TrafficFlow['protocol'],
      port: Number(col(cols, portIdx, '0')) || 0,
      bytes: Number(col(cols, bytesIdx, '0')) || 0,
      packets: Number(col(cols, pktsIdx, '0')) || 0,
      allowed: allowedStr === 'true' || allowedStr === 'yes' || allowedStr === '1',
      timestamp: col(cols, tsIdx, new Date().toISOString()),
    };
  });
}
