#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReportStore } from '../db/sqlite.js';
import { ReportService } from '../service/reportService.js';
import { ValidationError } from '../core/validate.js';
import type { ComputeInput, ComputeReport, PropertyResolution } from '../core/types.js';

function dbPath(): string {
  return process.env.CSS_EXPLAIN_DB ?? join(process.cwd(), 'data', 'reports.db');
}

function loadInput(file: string): ComputeInput {
  if (!file) throw new ValidationError('INPUT_MISSING', '缺少输入文件参数（可用 - 表示标准输入）');
  return JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8')) as ComputeInput;
}

function printErr(err: unknown): never {
  if (err instanceof ValidationError) {
    console.error(`错误 [${err.code}]: ${err.message}`);
  } else {
    console.error('错误:', err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
}

const SOURCE_LABEL: Record<PropertyResolution['source'], string> = {
  declared: '本元素声明',
  inherited: '继承自父元素',
  initial: '初始值',
};

export function formatReport(report: ComputeReport): string {
  const lines: string[] = [];
  lines.push(`算法版本: ${report.algorithmVersion}`);
  for (const [elId, el] of Object.entries(report.elements)) {
    lines.push(`元素 ${elId} <${el.tag}>`);
    for (const [, r] of Object.entries(el.properties)) {
      const origin =
        r.source === 'declared'
          ? r.declaredBy === 'inline'
            ? '行内'
            : `规则#${r.ruleIndex}(${r.selector})`
          : SOURCE_LABEL[r.source] + (r.inheritedFrom ? ` ${r.inheritedFrom}` : '');
      const imp = r.important ? ' !important' : '';
      lines.push(`  ${r.property.padEnd(11)} = ${r.value}${imp}   <- ${origin}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function formatExplain(r: PropertyResolution): string {
  const lines: string[] = [];
  lines.push(`属性 ${r.property}  最终值: ${r.value}  来源: ${SOURCE_LABEL[r.source]}`);
  lines.push('来源链:');
  for (const step of r.chain) lines.push(step);
  if (r.inheritedFrom) lines.push(`继承自元素: ${r.inheritedFrom}`);
  if (r.initial !== undefined) lines.push(`公布初始值: ${r.initial}`);
  if (r.losers.length > 0) {
    lines.push(`淘汰记录（${r.losers.length} 条）:`);
    for (const l of r.losers) {
      lines.push(`  x ${l.loser.origin === 'inline' ? '行内' : `规则#${l.loser.ruleIndex}`} "${l.loser.value}" 输在 ${l.reason}`);
    }
  }
  return lines.join('\n');
}

function usage(): void {
  console.log(
    [
      '用法: css-explain <命令> [参数]',
      '',
      '  compute <input.json>                 导入元素树与规则，计算全树并冻结报告',
      '  explain <reportId> <元素编号> <属性>   解释某元素某属性的来源链',
      '  history [limit]                      查询历史报告',
      '  export <reportId> [out.json]         导出报告 JSON（省略文件名输出到标准输出）',
      '  compare <reportIdA> <reportIdB>      比较两个报告版本的最终属性表',
      '',
      '环境变量:',
      '  CSS_EXPLAIN_DB   SQLite 文件路径（默认 ./data/reports.db）',
    ].join('\n'),
  );
}

function main(): void {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || cmd === '-h' || cmd === '--help') {
    usage();
    return;
  }
  const store = new ReportStore(dbPath());
  const service = new ReportService(store);

  try {
    if (cmd === 'compute') {
      const created = service.create(loadInput(args[0] ?? ''));
      console.log(`报告ID: ${created.id}${created.reused ? '（相同输入，复用已冻结报告）' : '（新报告）'}`);
      console.log(`算法版本: ${created.algorithmVersion}`);
      console.log(formatReport(created.report));
    } else if (cmd === 'explain') {
      const [id, elId, prop] = args;
      const out = service.explain(id!, elId!, prop!);
      if ('error' in out) {
        console.error(out.error);
        process.exit(1);
      }
      console.log(formatExplain(out.resolution as PropertyResolution));
    } else if (cmd === 'history') {
      const limit = Number(args[0] ?? '20');
      for (const h of service.history(Number.isFinite(limit) ? limit : 20)) {
        console.log(
          `${h.id}  ${h.createdAt}  元素=${h.elementCount}  算法=${h.algorithmVersion}  hash=${h.inputHash.slice(0, 12)}`,
        );
      }
    } else if (cmd === 'export') {
      const [id, outFile] = args;
      const loaded = service.get(id!);
      if (!loaded) {
        console.error(`报告不存在: ${id}`);
        process.exit(1);
      }
      const json = JSON.stringify(loaded.report, null, 2);
      if (outFile) {
        writeFileSync(outFile, json, 'utf8');
        console.log(`已导出到 ${outFile}`);
      } else {
        console.log(json);
      }
    } else if (cmd === 'compare') {
      const [a, b] = args;
      const out = service.compare(a!, b!);
      if ('error' in out) {
        console.error(out.error);
        process.exit(1);
      }
      console.log(`比较 ${a} -> ${b}: ${out.same ? '最终属性表完全相同' : `有 ${out.changed.length} 处变化`}`);
      for (const d of out.changed) {
        console.log(`  元素 ${d.elementId} ${d.property}: ${d.from} -> ${d.to}`);
      }
      if (out.onlyInBase.length) console.log(`仅基准存在: ${out.onlyInBase.join(', ')}`);
      if (out.onlyInTarget.length) console.log(`仅目标存在: ${out.onlyInTarget.join(', ')}`);
    } else {
      usage();
      process.exit(1);
    }
  } catch (err) {
    printErr(err);
  } finally {
    store.close();
  }
}

main();
