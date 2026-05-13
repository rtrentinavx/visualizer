import type { DcfPolicyModel, DcfPolicy, SmartGroup, WebGroup, ThreatGroup, GeoGroup, TrafficFlow } from '../types/dcf';

export type ItemType = 'smartGroup' | 'webGroup' | 'threatGroup' | 'geoGroup' | 'policy';

export type TopologyAction =
  | { type: 'replace'; topology: DcfPolicyModel }
  | { type: 'updateItem'; itemType: ItemType; itemId: string; data: Record<string, unknown> }
  | { type: 'deleteItem'; itemType: ItemType; itemId: string }
  | { type: 'createItem'; itemType: ItemType; id: string; data: Record<string, unknown> }
  | { type: 'addFlow'; flow: TrafficFlow }
  | { type: 'updateFlow'; id: string; data: Partial<TrafficFlow> }
  | { type: 'deleteFlow'; id: string }
  | { type: 'appendWebGroups'; webGroups: WebGroup[] }
  | { type: 'clearAll' };

const EMPTY_TOPOLOGY: DcfPolicyModel = {
  smartGroups: [
    { id: 'sg-any', name: 'Any', color: '#9ca3af', criteria: [], matchType: 'any' },
    { id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' },
  ],
  webGroups: [],
  threatGroups: [],
  geoGroups: [],
  policies: [],
  flows: [],
};

export function topologyReducer(state: DcfPolicyModel, action: TopologyAction): DcfPolicyModel {
  switch (action.type) {
    case 'replace':
      return action.topology;

    case 'clearAll':
      return { ...EMPTY_TOPOLOGY };

    case 'updateItem': {
      const { itemType, itemId, data } = action;
      if (itemId === '__new__') {
        return applyNewItem(state, itemType, data);
      }
      return applyUpdateItem(state, itemType, itemId, data);
    }

    case 'deleteItem':
      return applyDeleteItem(state, action.itemType, action.itemId);

    case 'createItem':
      return applyCreateItem(state, action.itemType, action.id, action.data);

    case 'addFlow':
      return { ...state, flows: [...state.flows, action.flow] };

    case 'updateFlow':
      return {
        ...state,
        flows: state.flows.map((f) => (f.id === action.id ? { ...f, ...action.data } : f)),
      };

    case 'deleteFlow':
      return { ...state, flows: state.flows.filter((f) => f.id !== action.id) };

    case 'appendWebGroups':
      return { ...state, webGroups: [...state.webGroups, ...action.webGroups] };
  }
}

function applyNewItem(state: DcfPolicyModel, itemType: ItemType, data: Record<string, unknown>): DcfPolicyModel {
  switch (itemType) {
    case 'smartGroup': {
      const sg: SmartGroup = {
        id: `sg-${Date.now()}`,
        name: 'New Smart Group',
        color: '#3b82f6',
        criteria: [],
        matchType: 'any',
        ...(data as Partial<SmartGroup>),
      };
      return { ...state, smartGroups: [...state.smartGroups, sg] };
    }
    case 'webGroup': {
      const wg: WebGroup = { id: `wg-${Date.now()}`, name: 'New Web Group', fqdns: [], ...(data as Partial<WebGroup>) };
      return { ...state, webGroups: [...state.webGroups, wg] };
    }
    case 'threatGroup': {
      const tg: ThreatGroup = {
        id: `tg-${Date.now()}`,
        name: 'New Threat Group',
        category: 'custom',
        entryCount: 0,
        ...(data as Partial<ThreatGroup>),
      };
      return { ...state, threatGroups: [...state.threatGroups, tg] };
    }
    case 'geoGroup': {
      const gg: GeoGroup = { id: `gg-${Date.now()}`, name: 'New Geo Group', countries: [], ...(data as Partial<GeoGroup>) };
      return { ...state, geoGroups: [...state.geoGroups, gg] };
    }
    case 'policy': {
      const maxPriority = state.policies.length > 0 ? Math.max(...state.policies.map((p) => p.priority)) : 0;
      const policy: DcfPolicy = {
        id: `pol-${Date.now()}`,
        name: 'New Policy',
        priority: maxPriority + 10,
        srcGroupId: (data.srcGroupId as string) || 'sg-any',
        dstGroupId: (data.dstGroupId as string) || 'sg-any',
        action: 'allow',
        protocol: 'tcp',
        logging: false,
        enforcement: true,
        ...(data as Partial<DcfPolicy>),
      };
      return { ...state, policies: [...state.policies, policy] };
    }
  }
}

function applyUpdateItem(state: DcfPolicyModel, itemType: ItemType, itemId: string, data: Record<string, unknown>): DcfPolicyModel {
  switch (itemType) {
    case 'smartGroup':
      return { ...state, smartGroups: state.smartGroups.map((g) => (g.id === itemId ? { ...g, ...data } as SmartGroup : g)) };
    case 'webGroup':
      return { ...state, webGroups: state.webGroups.map((g) => (g.id === itemId ? { ...g, ...data } as WebGroup : g)) };
    case 'threatGroup':
      return { ...state, threatGroups: state.threatGroups.map((g) => (g.id === itemId ? { ...g, ...data } as ThreatGroup : g)) };
    case 'geoGroup':
      return { ...state, geoGroups: state.geoGroups.map((g) => (g.id === itemId ? { ...g, ...data } as GeoGroup : g)) };
    case 'policy':
      return { ...state, policies: state.policies.map((p) => (p.id === itemId ? { ...p, ...data } as DcfPolicy : p)) };
  }
}

function applyDeleteItem(state: DcfPolicyModel, itemType: ItemType, itemId: string): DcfPolicyModel {
  switch (itemType) {
    case 'smartGroup':
      return {
        ...state,
        smartGroups: state.smartGroups.filter((g) => g.id !== itemId),
        policies: state.policies.filter((p) => p.srcGroupId !== itemId && p.dstGroupId !== itemId),
      };
    case 'webGroup':
      return {
        ...state,
        webGroups: state.webGroups.filter((g) => g.id !== itemId),
        policies: state.policies.map((p) => ({ ...p, webGroupIds: p.webGroupIds?.filter((id) => id !== itemId) })),
      };
    case 'threatGroup':
      return {
        ...state,
        threatGroups: state.threatGroups.filter((g) => g.id !== itemId),
        policies: state.policies.map((p) => (p.threatGroup === itemId ? { ...p, threatGroup: undefined } : p)),
      };
    case 'geoGroup':
      return {
        ...state,
        geoGroups: state.geoGroups.filter((g) => g.id !== itemId),
        policies: state.policies.map((p) => (p.geoGroup === itemId ? { ...p, geoGroup: undefined } : p)),
      };
    case 'policy':
      return { ...state, policies: state.policies.filter((p) => p.id !== itemId) };
  }
}

function applyCreateItem(state: DcfPolicyModel, itemType: ItemType, id: string, data: Record<string, unknown>): DcfPolicyModel {
  switch (itemType) {
    case 'smartGroup':
      return { ...state, smartGroups: [...state.smartGroups, { id, name: 'New Smart Group', color: '#3b82f6', criteria: [], matchType: 'any', ...data } as SmartGroup] };
    case 'webGroup':
      return { ...state, webGroups: [...state.webGroups, { id, name: 'New Web Group', fqdns: [], ...data } as WebGroup] };
    case 'threatGroup':
      return { ...state, threatGroups: [...state.threatGroups, { id, name: 'New Threat Group', category: 'custom', entryCount: 0, ...data } as ThreatGroup] };
    case 'geoGroup':
      return { ...state, geoGroups: [...state.geoGroups, { id, name: 'New Geo Group', countries: [], ...data } as GeoGroup] };
    case 'policy':
      return state; // policies use 'updateItem' with __new__; createItem is for groups only today
  }
}
