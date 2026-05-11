import { describe, it, expect } from 'vitest';
import {
  exportTopologyJSON,
  importTopologyJSON,
  exportFlowsCSV,
  importFlowsCSV,
  exportFlowsJSON,
  importFlowsJSON,
  importTerraformHCL,
} from './importExport';
import { generateTerraform } from './terraformExport';
import { demoTopology } from '../data/demoTopology';

describe('JSON round-trip', () => {
  it('exportTopologyJSON then importTopologyJSON preserves the demo topology', () => {
    const json = exportTopologyJSON(demoTopology);
    const restored = importTopologyJSON(json);
    expect(restored).toEqual(demoTopology);
  });

  it('importTopologyJSON throws on a payload missing smartGroups', () => {
    expect(() => importTopologyJSON(JSON.stringify({ policies: [] }))).toThrow(/smartGroups/);
  });

  it('importTopologyJSON throws on a payload missing policies', () => {
    expect(() => importTopologyJSON(JSON.stringify({ smartGroups: [] }))).toThrow(/policies/);
  });

  it('importTopologyJSON fills in defaults for optional collections', () => {
    const minimal = importTopologyJSON(
      JSON.stringify({ smartGroups: [], policies: [] }),
    );
    expect(minimal.webGroups).toEqual([]);
    expect(minimal.threatGroups).toEqual([]);
    expect(minimal.geoGroups).toEqual([]);
    expect(minimal.flows).toEqual([]);
  });
});

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
      const original = demoTopology.flows[i];
      const back = restored[i];
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
