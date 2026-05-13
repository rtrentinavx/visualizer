import { describe, it, expect } from 'vitest';
import {
  exportFlowsCSV,
  importFlowsCSV,
  exportFlowsJSON,
  importFlowsJSON,
  importTerraformHCL,
} from './importExport';
import { generateTerraform } from './terraformExport';
import { demoTopology } from '../data/demoTopology';

describe('Flows JSON round-trip', () => {
  it('exportFlowsJSON → importFlowsJSON yields equivalent flows', () => {
    const json = exportFlowsJSON(demoTopology.flows);
    const restored = importFlowsJSON(json);
    expect(restored).toEqual(demoTopology.flows);
  });
});

describe('Flows CSV round-trip (lossy on group IDs by design)', () => {
  it('round-trips the count and primary fields of every flow', () => {
    const csv = exportFlowsCSV(demoTopology.flows, demoTopology);
    const restored = importFlowsCSV(csv);
    expect(restored).toHaveLength(demoTopology.flows.length);

    // Per-flow: port, protocol, bytes, packets, allowed, timestamp all preserved.
    // Group identities round-trip as the smart group *name* string (not ID),
    // because exportFlowsCSV writes names. We verify the structural fields.
    for (let i = 0; i < demoTopology.flows.length; i++) {
      const original = demoTopology.flows[i]!;
      const back = restored[i]!;
      expect(back.protocol).toBe(original.protocol);
      expect(back.port).toBe(original.port);
      expect(back.bytes).toBe(original.bytes);
      expect(back.packets).toBe(original.packets);
      expect(back.allowed).toBe(original.allowed);
      expect(back.timestamp).toBe(original.timestamp);
    }
  });
});

describe('Terraform HCL import (from exported HCL)', () => {
  // generateTerraform → importTerraformHCL is a lossy round-trip by design
  // (the exporter emits comments instead of real resources for WebGroups,
  // ThreatGroups and GeoGroups; IDs are regenerated on import). So we assert
  // the structural invariants the API guarantees, not deep equality.
  const hcl = generateTerraform(demoTopology);
  const imported = importTerraformHCL(hcl);

  it('imports every exported SmartGroup (excluding sg-any / sg-internet)', () => {
    const expectedNames = demoTopology.smartGroups
      .filter((g) => g.id !== 'sg-any' && g.id !== 'sg-internet')
      .map((g) => g.name)
      .sort();
    const importedNames = imported.smartGroups.map((g) => g.name).sort();
    expect(importedNames).toEqual(expectedNames);
  });

  it('imports every exported policy with name, priority, and action preserved', () => {
    expect(imported.policies).toHaveLength(demoTopology.policies.length);

    const importedByName = new Map(imported.policies.map((p) => [p.name, p]));
    for (const original of demoTopology.policies) {
      const back = importedByName.get(original.name);
      expect(back, `policy "${original.name}" should round-trip`).toBeDefined();
      expect(back!.priority).toBe(original.priority);
      expect(back!.action).toBe(original.action);
      expect(back!.protocol).toBe(original.protocol);
    }
  });

  it('regenerates a usable topology shape (all required collections present)', () => {
    expect(Array.isArray(imported.smartGroups)).toBe(true);
    expect(Array.isArray(imported.policies)).toBe(true);
    expect(Array.isArray(imported.webGroups)).toBe(true);
    expect(Array.isArray(imported.threatGroups)).toBe(true);
    expect(Array.isArray(imported.geoGroups)).toBe(true);
    expect(Array.isArray(imported.flows)).toBe(true);
  });
});

// =============================================================================
// Real Aviatrix-provider HCL shapes (from controller terraform export)
// =============================================================================

describe('Terraform HCL import — real Aviatrix provider shapes', () => {
  it('extracts WebGroups with snifilter and urlfilter into the fqdns array', () => {
    const hcl = `
      resource "aviatrix_web_group" "web_group_2" {
        name = "oracle_com"
        selector {
          match_expressions { snifilter = "*.oracle.com" }
        }
      }
      resource "aviatrix_web_group" "web_group_4" {
        name = "KCCD_Allowed_URLs"
        selector {
          match_expressions { urlfilter = "*.adata.prod.zpath.net" }
          match_expressions { urlfilter = "*.connector.msappproxy.net" }
          match_expressions { urlfilter = "*.elluciancloud.com" }
        }
      }
    `;
    const topo = importTerraformHCL(hcl);
    expect(topo.webGroups).toHaveLength(2);
    const oracle = topo.webGroups.find((g) => g.name === 'oracle_com')!;
    const urls = topo.webGroups.find((g) => g.name === 'KCCD_Allowed_URLs')!;
    expect(oracle.fqdns).toEqual(['*.oracle.com']);
    expect(urls.fqdns).toEqual(['*.adata.prod.zpath.net', '*.connector.msappproxy.net', '*.elluciancloud.com']);
  });

  it('extracts a bare-cidr match_expression as a subnet criterion (no `type` required)', () => {
    const hcl = `
      resource "aviatrix_smart_group" "smart_group_2" {
        name = "on-prem"
        selector {
          match_expressions { cidr = "10.0.0.0/8" }
          match_expressions { cidr = "192.168.0.0/16" }
        }
      }
    `;
    const topo = importTerraformHCL(hcl);
    expect(topo.smartGroups).toHaveLength(1);
    const sg = topo.smartGroups[0]!;
    expect(sg.criteria).toEqual([
      { type: 'subnet', cidr: '10.0.0.0/8' },
      { type: 'subnet', cidr: '192.168.0.0/16' },
    ]);
  });

  it('extracts a `type = "vpc"` match_expression with `name = "..."` as a vm-typed criterion', () => {
    const hcl = `
      resource "aviatrix_smart_group" "smart_group_1" {
        name = "EUC"
        selector {
          match_expressions {
            type = "vpc"
            name = "kccd-euc"
          }
        }
      }
    `;
    const topo = importTerraformHCL(hcl);
    expect(topo.smartGroups[0]!.criteria).toEqual([
      { type: 'vm', key: 'vpc', operator: 'equals', value: 'kccd-euc' },
    ]);
  });

  it('extracts a `tags = { k = "v", ... }` map as multiple vm criteria', () => {
    const hcl = `
      resource "aviatrix_smart_group" "tagged" {
        name = "Tagged"
        selector {
          match_expressions {
            type = "vm"
            tags = { Env = "prod", Tier = "web" }
          }
        }
      }
    `;
    const topo = importTerraformHCL(hcl);
    const c = topo.smartGroups[0]!.criteria;
    // Order is object-key-iteration order; we just check membership.
    expect(c).toHaveLength(2);
    expect(c).toContainEqual({ type: 'vm', key: 'Env', operator: 'equals', value: 'prod' });
    expect(c).toContainEqual({ type: 'vm', key: 'Tier', operator: 'equals', value: 'web' });
  });

  it('resolves policy `web_groups` by name when the WebGroup is in the same file', () => {
    const hcl = `
      resource "aviatrix_smart_group" "src" { name = "Src" selector { match_expressions { cidr = "10.0.0.0/24" } } }
      resource "aviatrix_smart_group" "dst" { name = "Dst" selector { match_expressions { cidr = "10.0.1.0/24" } } }
      resource "aviatrix_web_group" "sfdc" {
        name = "Salesforce"
        selector { match_expressions { snifilter = "*.salesforce.com" } }
      }
      resource "aviatrix_distributed_firewalling_policy_list" "list_1" {
        policies {
          name = "WebToSFDC"
          action = "PERMIT"
          src_smart_groups = ["Src"]
          dst_smart_groups = ["Dst"]
          web_groups = ["Salesforce"]
          priority = 100
          protocol = "TCP"
          logging = true
        }
      }
    `;
    const topo = importTerraformHCL(hcl);
    const policy = topo.policies[0]!;
    expect(policy.name).toBe('WebToSFDC');
    expect(policy.webGroupIds).toHaveLength(1);
    expect(policy.webGroupIds![0]).toBe(topo.webGroups.find((w) => w.name === 'Salesforce')!.id);
  });

  it('silently skips controller-emitted UUID web_groups references (no .tfstate available)', () => {
    const hcl = `
      resource "aviatrix_web_group" "wg" { name = "WG" selector { match_expressions { snifilter = "x.com" } } }
      resource "aviatrix_distributed_firewalling_policy_list" "list_1" {
        policies {
          name = "P"
          action = "PERMIT"
          src_smart_groups = ["def000ad-0000-0000-0000-000000000001"]
          dst_smart_groups = ["def000ad-0000-0000-0000-000000000000"]
          web_groups = ["def000ad-0000-0000-0000-000000000002"]
          priority = 1
          protocol = "ANY"
        }
      }
    `;
    const topo = importTerraformHCL(hcl);
    // UUID didn't match -> attribute is absent, but the policy still imports.
    expect(topo.policies).toHaveLength(1);
    expect(topo.policies[0]!.webGroupIds).toBeUndefined();
  });
});
