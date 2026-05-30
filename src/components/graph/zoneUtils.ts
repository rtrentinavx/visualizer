import type { SmartGroup } from '../../types/dcf';

export type Zone = 'internet' | 'dmz' | 'app' | 'data' | 'any-rail';

export const ZONE_ORDER: Zone[] = ['internet', 'dmz', 'app', 'data', 'any-rail'];

const DMZ_PATTERN = /\b(web|front|dmz|public|nginx|lb|loadbalancer|load[-_]?balancer|proxy|edge|ingress)\b/i;
const DATA_PATTERN = /\b(db|data|sql|redis|mongo|mongodb|mysql|postgres|postgresql|pci|vault|cache|storage|s3|blob|rds)\b/i;

function hasOnlySubnetCriteria(group: SmartGroup): boolean {
  return (
    group.criteria.length > 0 &&
    group.criteria.every((c) => c.type === 'subnet' && c.cidr !== undefined)
  );
}

export function assignZone(group: SmartGroup): Zone {
  if (group.id === 'sg-internet') return 'internet';
  if (group.id === 'sg-any') return 'any-rail';

  const name = group.name;

  if (DMZ_PATTERN.test(name)) return 'dmz';
  if (DATA_PATTERN.test(name)) return 'data';

  // Subnet-only groups are likely dedicated backend segments defined by CIDR.
  if (hasOnlySubnetCriteria(group)) return 'data';

  return 'app';
}

const ZONE_LABELS: Record<Zone, string> = {
  internet: 'Internet',
  dmz: 'DMZ / Public',
  app: 'Application',
  data: 'Data / Storage',
  'any-rail': 'Any (wildcard)',
};

export function getZoneLabel(zone: Zone): string {
  return ZONE_LABELS[zone];
}

export function getZoneBandY(zone: Zone, canvasHeight: number): number {
  const bandHeight = getZoneBandHeight(canvasHeight);
  const index = ZONE_ORDER.indexOf(zone);
  return bandHeight * index + bandHeight / 2;
}

export function getZoneBandHeight(canvasHeight: number): number {
  return canvasHeight / ZONE_ORDER.length;
}
