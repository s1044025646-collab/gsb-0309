import { createHash, randomUUID } from 'node:crypto';
import type { ComputeInput, ComputeReport, PropertyName } from '../core/types.js';
import { PROPERTIES } from '../core/types.js';
import { compute } from '../core/cascade.js';
import { ALGORITHM_VERSION } from '../core/validate.js';
import { ReportStore, type ReportRecord } from '../db/sqlite.js';

export interface CreatedReport {
  id: string;
  reused: boolean;
  algorithmVersion: string;
  inputHash: string;
  createdAt: string;
  report: ComputeReport;
}

export interface PropertyDiff {
  elementId: string;
  property: PropertyName;
  from: string;
  to: string;
  changed: boolean;
}

export interface ReportComparison {
  baseId: string;
  targetId: string;
  same: boolean;
  changed: PropertyDiff[];
  onlyInBase: string[];
  onlyInTarget: string[];
}

/** 规范化输入用于哈希：保证键顺序无关，数组（规则顺序）保持有序。 */
export function canonicalInput(input: ComputeInput): string {
  return JSON.stringify({
    tree: input.tree,
    rules: input.rules,
    inline: input.inline ?? {},
  });
}

export function hashInput(input: ComputeInput): string {
  return createHash('sha256').update(canonicalInput(input)).digest('hex');
}

export class ReportService {
  constructor(private store: ReportStore) {}

  /**
   * 计算并冻结报告。
   * compute 对整棵树要么全部成功要么抛错；只有成功后才写库，
   * 因此一次计算失败绝不会保存为成功的部分元素集合。
   */
  create(input: ComputeInput): CreatedReport {
    const inputHash = hashInput(input);
    const existing = this.store.findByHash(inputHash);
    if (existing) {
      return {
        id: existing.id,
        reused: true,
        algorithmVersion: existing.algorithmVersion,
        inputHash,
        createdAt: existing.createdAt,
        report: JSON.parse(existing.reportJson) as ComputeReport,
      };
    }

    const report = compute(input); // 失败则抛出，下面的 save 不会执行
    const rec: ReportRecord = {
      id: randomUUID(),
      algorithmVersion: ALGORITHM_VERSION,
      inputHash,
      inputJson: canonicalInput(input),
      reportJson: JSON.stringify(report),
      createdAt: new Date().toISOString(),
    };
    this.store.save(rec);
    return {
      id: rec.id,
      reused: false,
      algorithmVersion: rec.algorithmVersion,
      inputHash,
      createdAt: rec.createdAt,
      report,
    };
  }

  /** 仅计算不落库（供不需要持久化的调用）。 */
  preview(input: ComputeInput): ComputeReport {
    return compute(input);
  }

  get(id: string): { record: ReportRecord; report: ComputeReport } | null {
    const record = this.store.getById(id);
    if (!record) return null;
    return { record, report: JSON.parse(record.reportJson) as ComputeReport };
  }

  history(limit = 20): Array<{
    id: string;
    algorithmVersion: string;
    inputHash: string;
    createdAt: string;
    elementCount: number;
  }> {
    return this.store.list(limit).map((r) => {
      const report = JSON.parse(r.reportJson) as ComputeReport;
      return {
        id: r.id,
        algorithmVersion: r.algorithmVersion,
        inputHash: r.inputHash,
        createdAt: r.createdAt,
        elementCount: Object.keys(report.elements).length,
      };
    });
  }

  explain(
    id: string,
    elementId: string,
    property: string,
  ): { reportId: string; elementId: string; resolution: unknown } | { error: string } {
    const loaded = this.get(id);
    if (!loaded) return { error: `报告不存在: ${id}` };
    if (!(PROPERTIES as readonly string[]).includes(property)) {
      return { error: `未知属性: ${property}` };
    }
    const el = loaded.report.elements[elementId];
    if (!el) return { error: `报告中不存在元素: ${elementId}` };
    return {
      reportId: id,
      elementId,
      resolution: el.properties[property as PropertyName],
    };
  }

  /** 比较两个已冻结报告的最终属性表。 */
  compare(baseId: string, targetId: string): ReportComparison | { error: string } {
    const base = this.get(baseId);
    const target = this.get(targetId);
    if (!base) return { error: `基准报告不存在: ${baseId}` };
    if (!target) return { error: `目标报告不存在: ${targetId}` };

    const baseIds = new Set(Object.keys(base.report.elements));
    const targetIds = new Set(Object.keys(target.report.elements));
    const changed: PropertyDiff[] = [];

    for (const elId of baseIds) {
      if (!targetIds.has(elId)) continue;
      for (const p of PROPERTIES) {
        const from = base.report.elements[elId]!.properties[p]!.value;
        const to = target.report.elements[elId]!.properties[p]!.value;
        if (from !== to) changed.push({ elementId: elId, property: p, from, to, changed: true });
      }
    }

    return {
      baseId,
      targetId,
      same: changed.length === 0,
      changed,
      onlyInBase: [...baseIds].filter((x) => !targetIds.has(x)),
      onlyInTarget: [...targetIds].filter((x) => !baseIds.has(x)),
    };
  }
}
