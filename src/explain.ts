import { ApiError } from './errors.js';
import { PROPERTIES, type ComputeResult, type PropertyName, type PropertyResult } from './types.js';

export function explain(
  result: ComputeResult,
  elementId: number,
  property: string,
): { elementId: number; property: PropertyName; explanation: PropertyResult } {
  if (!PROPERTIES.includes(property as PropertyName)) {
    throw new ApiError('UNKNOWN_PROPERTY', `未知属性 "${property}"，仅支持 ${PROPERTIES.join(', ')}`);
  }
  const el = result.elements.find((e) => e.elementId === elementId);
  if (!el) throw new ApiError('NOT_FOUND', `元素 ${elementId} 不存在于该报告`);
  return {
    elementId,
    property: property as PropertyName,
    explanation: el.properties[property as PropertyName],
  };
}

export interface PropertyDiff {
  elementId: number;
  property: PropertyName;
  a: { value: string; source: unknown };
  b: { value: string; source: unknown };
}

export function compareResults(a: ComputeResult, b: ComputeResult): PropertyDiff[] {
  const diffs: PropertyDiff[] = [];
  const bById = new Map(b.elements.map((e) => [e.elementId, e]));
  for (const ea of a.elements) {
    const eb = bById.get(ea.elementId);
    if (!eb) continue;
    for (const prop of PROPERTIES) {
      const pa = ea.properties[prop];
      const pb = eb.properties[prop];
      if (pa.value !== pb.value || JSON.stringify(pa.source) !== JSON.stringify(pb.source)) {
        diffs.push({
          elementId: ea.elementId,
          property: prop,
          a: { value: pa.value, source: pa.source },
          b: { value: pb.value, source: pb.source },
        });
      }
    }
  }
  return diffs;
}
