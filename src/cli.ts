import fs from 'node:fs';
import { computeStyles } from './cascade.js';
import { Store } from './db.js';
import { ApiError } from './errors.js';
import { compareResults, explain } from './explain.js';
import { startServer } from './server.js';
import { validateInput } from './validate.js';
import { buildDemoInput } from './demo.js';
import type { ComputeInput, PropertyResult } from './types.js';

function formatSource(r: PropertyResult): string {
  const s = r.source;
  const kw = r.keyword ? `（关键字 ${r.keyword}）` : '';
  switch (s.kind) {
    case 'rule':
      return `规则 #${s.ruleIndex} "${s.selector}"${s.important ? ' !important' : ''}${kw}`;
    case 'inline':
      return `行内声明${s.important ? ' !important' : ''}${kw}`;
    case 'inherited':
      return `继承自元素 ${s.fromElement}${kw}`;
    case 'initial':
      return `初始值${kw}`;
  }
}

function printExplanation(ex: PropertyResult): void {
  console.log(`  ${ex.property} = ${ex.value}  <= ${formatSource(ex)}`);
  for (const c of ex.candidates) {
    const from = c.source === 'inline' ? '行内' : `规则 #${c.ruleIndex} "${c.selector}"`;
    const spec = c.specificity ? ` 特异性(${c.specificity.join(',')})` : '';
    const imp = c.important ? ' !important' : '';
    if (c.outcome === 'winner') {
      console.log(`    [胜] ${from}${imp}${spec} => ${c.value}`);
    } else {
      const reason =
        c.lostReason === 'importance' ? '重要性' : c.lostReason === 'specificity' ? '特异性' : '顺序';
      console.log(`    [负·${reason}] ${from}${imp}${spec} => ${c.value}`);
    }
  }
}

function computeAndSave(store: Store, input: ComputeInput): number {
  validateInput(input);
  const result = computeStyles(input);
  return store.saveReport(input, result);
}

function printReport(store: Store, id: number): void {
  const report = store.getReport(id);
  console.log(`报告 #${report.id}（算法版本 ${report.algo_version}，${report.created_at}）`);
  for (const el of report.result.elements) {
    console.log(`元素 ${el.elementId}:`);
    for (const prop of Object.values(el.properties)) {
      console.log(`  ${prop.property} = ${prop.value}  <= ${formatSource(prop)}`);
    }
  }
}

const USAGE = [
  '用法: node dist/cli.js <命令>',
  '  serve [--port N]   启动 API 服务（默认自动选择空闲端口）',
  '  compute <file>     导入元素树与规则 JSON，计算全树样式并保存报告',
  '  list               查询历史报告',
  '  explain <报告> <元素> <属性>   解释某元素某属性的来源链',
  '  compare <a> <b>    比较两个报告版本',
  '  export <报告>      JSON 导出报告',
  '  demo               运行内置演示',
].join('\n');

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  const store = new Store();

  switch (cmd) {
    case 'serve': {
      const portIdx = args.indexOf('--port');
      const port = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.PORT ?? 0);
      const actual = await startServer(store, Number.isInteger(port) ? port : 0);
      console.log(`API 服务已启动: http://localhost:${actual}`);
      break;
    }
    case 'compute': {
      const file = args[0];
      if (!file) throw new ApiError('BAD_REQUEST', '用法: compute <input.json>');
      const input = JSON.parse(fs.readFileSync(file, 'utf-8')) as ComputeInput;
      const id = computeAndSave(store, input);
      console.log(`已保存报告 #${id}`);
      printReport(store, id);
      break;
    }
    case 'list': {
      for (const r of store.listReports()) {
        console.log(`#${r.id}  ${r.created_at}  algo=${r.algo_version}`);
      }
      break;
    }
    case 'explain': {
      const [id, element, property] = args;
      const report = store.getReport(Number(id));
      const ex = explain(report.result, Number(element), property);
      console.log(`报告 #${id} 元素 ${ex.elementId}:`);
      printExplanation(ex.explanation);
      break;
    }
    case 'compare': {
      const [a, b] = args.map(Number);
      const diffs = compareResults(store.getReport(a).result, store.getReport(b).result);
      if (diffs.length === 0) console.log('两个报告结果一致');
      for (const d of diffs) {
        console.log(`元素 ${d.elementId} ${d.property}: ${d.a.value} -> ${d.b.value}`);
      }
      break;
    }
    case 'export': {
      const report = store.getReport(Number(args[0]));
      console.log(JSON.stringify(report, null, 2));
      break;
    }
    case 'demo': {
      const input = buildDemoInput();
      const id = computeAndSave(store, input);
      console.log(`演示输入已计算并保存为报告 #${id}\n`);
      printReport(store, id);
      console.log('\n关键解释：');
      const report = store.getReport(id);
      for (const [el, prop] of [
        [2, 'color'],
        [3, 'color'],
        [4, 'color'],
        [5, 'color'],
      ] as Array<[number, string]>) {
        const ex = explain(report.result, el, prop);
        console.log(`元素 ${el} 的 ${prop}:`);
        printExplanation(ex.explanation);
      }
      break;
    }
    default:
      console.log(USAGE);
  }
}

main().catch((err) => {
  if (err instanceof ApiError) {
    console.error(`错误 [${err.code}] ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
