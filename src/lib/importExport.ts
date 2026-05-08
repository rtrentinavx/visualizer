import type { DcfPolicyModel, SmartGroup, DcfPolicy, SmartGroupCriteria } from '../types/dcf';

// ---------- JSON Export / Import ----------

export function exportTopologyJSON(topology: DcfPolicyModel): string {
  return JSON.stringify(topology, null, 2);
}

export function downloadTopologyJSON(topology: DcfPolicyModel): void {
  const content = exportTopologyJSON(topology);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dcf-topology.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importTopologyJSON(json: string): DcfPolicyModel {
  const parsed = JSON.parse(json) as DcfPolicyModel;
  // Validate basic structure
  if (!parsed.smartGroups || !Array.isArray(parsed.smartGroups)) {
    throw new Error('Invalid topology: missing smartGroups array');
  }
  if (!parsed.policies || !Array.isArray(parsed.policies)) {
    throw new Error('Invalid topology: missing policies array');
  }
  return {
    smartGroups: parsed.smartGroups,
    webGroups: parsed.webGroups || [],
    threatGroups: parsed.threatGroups || [],
    geoGroups: parsed.geoGroups || [],
    policies: parsed.policies,
    flows: parsed.flows || [],
  };
}

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
  while (idx.i < tokens.length && tokens[idx.i] !== '{' && !tokens[idx.i].startsWith('"') === false) {
    if (tokens[idx.i].startsWith('"') && tokens[idx.i].endsWith('"')) {
      labels.push(tokens[idx.i].slice(1, -1));
      idx.i++;
    } else {
      break;
    }
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
    if (tokens[idx.i + 1] === '=') {
      const key = tokens[idx.i];
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
  return colors[Math.floor(Math.random() * colors.length)];
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
        const type = getString(me, 'type') || 'vm';
        const criteriaItem: SmartGroupCriteria = { type: type as 'vm' | 'subnet' };
        if (type === 'vm') {
          const key = getString(me, 'key');
          if (key) {
            // Strip "tag:" prefix if present
            criteriaItem.key = key.startsWith('tag:') ? key.slice(4) : key;
          }
          const val = getString(me, 'val') || getString(me, 'value');
          if (val !== undefined) {
            criteriaItem.value = val;
            criteriaItem.operator = 'equals';
          }
        } else if (type === 'subnet') {
          const cidr = getString(me, 'cidr');
          if (cidr) criteriaItem.cidr = cidr;
        }
        criteria.push(criteriaItem);
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

  // Helper to resolve group references
  function resolveGroupRef(ref: string): string | null {
    // Direct name match
    const byName = smartGroups.find((g) => g.name === ref);
    if (byName) return byName.id;
    // Terraform reference: aviatrix_smart_group.<name>.name
    const match = ref.match(/aviatrix_smart_group\.([a-zA-Z0-9_]+)\.(?:name|id)/);
    if (match) {
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
      const srcId = srcRefs.length > 0 ? (resolveGroupRef(srcRefs[0]) || 'sg-any') : 'sg-any';
      const dstId = dstRefs.length > 0 ? (resolveGroupRef(dstRefs[0]) || 'sg-any') : 'sg-any';

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

      policies.push({
        id: `pol-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        priority,
        srcGroupId: srcId,
        dstGroupId: dstId,
        srcExcludeGroupIds: srcExcludeIds.length > 0 ? srcExcludeIds : undefined,
        dstExcludeGroupIds: dstExcludeIds.length > 0 ? dstExcludeIds : undefined,
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
    webGroups: [],
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
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
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

  return rows.map((row, i) => {
    const cols = row.split(',').map((c) => c.trim());
    return {
      id: `flow-${Date.now()}-${i}`,
      srcGroupId: srcIdx >= 0 ? cols[srcIdx] : 'sg-any',
      dstGroupId: dstIdx >= 0 ? cols[dstIdx] : 'sg-any',
      protocol: (protoIdx >= 0 ? cols[protoIdx] : 'tcp') as TrafficFlow['protocol'],
      port: Number(portIdx >= 0 ? cols[portIdx] : 0) || 0,
      bytes: Number(bytesIdx >= 0 ? cols[bytesIdx] : 0) || 0,
      packets: Number(pktsIdx >= 0 ? cols[pktsIdx] : 0) || 0,
      allowed: allowedIdx >= 0 ? cols[allowedIdx].toLowerCase() === 'true' || cols[allowedIdx].toLowerCase() === 'yes' || cols[allowedIdx] === '1' : false,
      timestamp: tsIdx >= 0 ? cols[tsIdx] : new Date().toISOString(),
    };
  });
}
