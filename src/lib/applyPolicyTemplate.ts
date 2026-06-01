import type { DcfPolicyModel, DcfPolicy, SmartGroup, WebGroup, ThreatGroup, GeoGroup } from '../types/dcf';
import type { PolicyTemplate } from '../data/policyTemplates';

export interface ApplyTemplateResult {
  topology: DcfPolicyModel;
  added: {
    smartGroups: SmartGroup[];
    webGroups: WebGroup[];
    threatGroups: ThreatGroup[];
    geoGroups: GeoGroup[];
    policies: DcfPolicy[];
  };
  reused: {
    smartGroupNames: string[];
    webGroupNames: string[];
    threatGroupNames: string[];
    geoGroupNames: string[];
  };
  skipped: {
    duplicatePolicies: string[];
  };
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function resolveRefs<T extends { refId: string; name: string }, R extends { id: string; name: string }>(
  templateEntities: readonly T[],
  existingEntities: readonly R[],
  buildNew: (tpl: T) => R,
  addedAccumulator: R[],
  reusedNames: string[],
): Record<string, string> {
  const refMap: Record<string, string> = {};
  for (const tpl of templateEntities) {
    const match = existingEntities.find((e) => e.name === tpl.name);
    if (match) {
      refMap[tpl.refId] = match.id;
      reusedNames.push(match.name);
    } else {
      const created = buildNew(tpl);
      refMap[tpl.refId] = created.id;
      addedAccumulator.push(created);
    }
  }
  return refMap;
}

function policyMatchKey(p: { name: string; srcGroupId: string | string[]; dstGroupId: string | string[]; action: string }): string {
  const src = Array.isArray(p.srcGroupId) ? p.srcGroupId.slice().sort().join(',') : p.srcGroupId;
  const dst = Array.isArray(p.dstGroupId) ? p.dstGroupId.slice().sort().join(',') : p.dstGroupId;
  return `${p.name}|${src}|${dst}|${p.action}`;
}

function bumpPriorityIfTaken(target: number, taken: Set<number>): number {
  let p = target;
  while (taken.has(p)) p += 1;
  taken.add(p);
  return p;
}

export function applyPolicyTemplate(topology: DcfPolicyModel, template: PolicyTemplate): ApplyTemplateResult {
  const added: ApplyTemplateResult['added'] = {
    smartGroups: [],
    webGroups: [],
    threatGroups: [],
    geoGroups: [],
    policies: [],
  };
  const reused: ApplyTemplateResult['reused'] = {
    smartGroupNames: [],
    webGroupNames: [],
    threatGroupNames: [],
    geoGroupNames: [],
  };
  const skipped: ApplyTemplateResult['skipped'] = { duplicatePolicies: [] };

  const sgRefMap: Record<string, string> = { 'sg-any': 'sg-any', 'sg-internet': 'sg-internet' };
  Object.assign(
    sgRefMap,
    resolveRefs(
      template.smartGroups,
      topology.smartGroups,
      (tpl) => ({
        id: newId('sg'),
        name: tpl.name,
        color: tpl.color,
        criteria: tpl.criteria,
        matchType: tpl.matchType,
      }),
      added.smartGroups,
      reused.smartGroupNames,
    ),
  );

  const wgRefMap = resolveRefs(
    template.webGroups ?? [],
    topology.webGroups,
    (tpl) => ({ id: newId('wg'), name: tpl.name, fqdns: tpl.fqdns }),
    added.webGroups,
    reused.webGroupNames,
  );

  const tgRefMap = resolveRefs(
    template.threatGroups ?? [],
    topology.threatGroups,
    (tpl) => ({ id: newId('tg'), name: tpl.name, category: tpl.category, entryCount: tpl.entryCount }),
    added.threatGroups,
    reused.threatGroupNames,
  );

  const ggRefMap = resolveRefs(
    template.geoGroups ?? [],
    topology.geoGroups,
    (tpl) => ({ id: newId('gg'), name: tpl.name, countries: tpl.countries }),
    added.geoGroups,
    reused.geoGroupNames,
  );

  const takenPriorities = new Set<number>(topology.policies.map((p) => p.priority));
  const existingPolicyKeys = new Set(topology.policies.map(policyMatchKey));

  for (const tplPolicy of template.policies) {
    const srcId = sgRefMap[tplPolicy.srcGroupRef];
    const dstId = sgRefMap[tplPolicy.dstGroupRef];
    if (!srcId || !dstId) continue;

    const key = policyMatchKey({ name: tplPolicy.name, srcGroupId: srcId, dstGroupId: dstId, action: tplPolicy.action });
    if (existingPolicyKeys.has(key)) {
      skipped.duplicatePolicies.push(tplPolicy.name);
      continue;
    }

    const policy: DcfPolicy = {
      id: newId('pol'),
      name: tplPolicy.name,
      priority: bumpPriorityIfTaken(tplPolicy.priority, takenPriorities),
      srcGroupId: [srcId],
      dstGroupId: [dstId],
      action: tplPolicy.action,
      protocol: tplPolicy.protocol,
      ports: tplPolicy.ports,
      logging: tplPolicy.logging,
      enforcement: tplPolicy.enforcement ?? true,
      decrypt: tplPolicy.decrypt,
    };

    if (tplPolicy.threatGroupRef) {
      const id = tgRefMap[tplPolicy.threatGroupRef];
      if (id) policy.threatGroup = id;
    }
    if (tplPolicy.geoGroupRef) {
      const id = ggRefMap[tplPolicy.geoGroupRef];
      if (id) policy.geoGroup = id;
    }
    if (tplPolicy.webGroupRefs && tplPolicy.webGroupRefs.length > 0) {
      policy.webGroupIds = tplPolicy.webGroupRefs
        .map((ref) => wgRefMap[ref])
        .filter((id): id is string => Boolean(id));
    }

    added.policies.push(policy);
    existingPolicyKeys.add(key);
  }

  return {
    topology: {
      smartGroups: [...topology.smartGroups, ...added.smartGroups],
      webGroups: [...topology.webGroups, ...added.webGroups],
      threatGroups: [...topology.threatGroups, ...added.threatGroups],
      geoGroups: [...topology.geoGroups, ...added.geoGroups],
      policies: [...topology.policies, ...added.policies],
      flows: topology.flows,
    },
    added,
    reused,
    skipped,
  };
}

export function previewPolicyTemplate(topology: DcfPolicyModel, template: PolicyTemplate): ApplyTemplateResult {
  return applyPolicyTemplate(topology, template);
}
