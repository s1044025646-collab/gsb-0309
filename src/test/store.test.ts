import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeStyles } from '../cascade.js';
import { Store } from '../db.js';
import { compareResults, explain } from '../explain.js';
import { validateInput } from '../validate.js';
import type { ComputeInput } from '../types.js';

const input: ComputeInput = {
  elements: [
    { id: 1, tag: 'div', parent: null, classes: ['root'] },
    { id: 2, tag: 'p', parent: 1 },
  ],
  rules: [{ selector: '.root', declarations: [{ property: 'color', value: 'green' }] }],
};

test('报告保存后可重新读取并解释（模拟重启）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cssc-'));
  const dbPath = path.join(dir, 'test.db');
  const store1 = new Store(dbPath);
  validateInput(input);
  const result = computeStyles(input);
  const id = store1.saveReport(input, result);
  store1.close();

  const store2 = new Store(dbPath);
  const report = store2.getReport(id);
  assert.equal(report.algo_version, result.algoVersion);
  const ex = explain(report.result, 2, 'color');
  assert.equal(ex.explanation.value, 'green');
  assert.deepEqual(ex.explanation.source, { kind: 'inherited', fromElement: 1 });
  assert.equal(store2.listReports().length, 1);
  store2.close();
});

test('比较两个报告版本', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cssc-'));
  const store = new Store(path.join(dir, 'test.db'));
  const r1 = computeStyles(input);
  const id1 = store.saveReport(input, r1);
  const input2: ComputeInput = {
    ...input,
    rules: [{ selector: '.root', declarations: [{ property: 'color', value: 'red' }] }],
  };
  const id2 = store.saveReport(input2, computeStyles(input2));
  const diffs = compareResults(store.getReport(id1).result, store.getReport(id2).result);
  assert.ok(diffs.some((d) => d.elementId === 1 && d.property === 'color'));
  assert.ok(diffs.some((d) => d.elementId === 2 && d.property === 'color')); // 继承值随之变化
  assert.ok(!diffs.some((d) => d.property === 'display'));
  store.close();
});

test('计算失败不落库', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cssc-'));
  const store = new Store(path.join(dir, 'test.db'));
  assert.throws(() =>
    validateInput({
      elements: [{ id: 1, tag: 'div', parent: null }],
      rules: [{ selector: 'div p', declarations: [] }],
    }),
  );
  assert.equal(store.listReports().length, 0);
  store.close();
});
