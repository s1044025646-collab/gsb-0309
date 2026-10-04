import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeStyles } from '../cascade.js';
import { validateInput } from '../validate.js';
import { compareSpecificity, parseSelector } from '../selector.js';
import { ApiError } from '../errors.js';
import { INITIAL_VALUES, type ComputeInput, type PropertyName } from '../types.js';

function compute(input: ComputeInput) {
  validateInput(input);
  return computeStyles(input);
}

function val(result: ReturnType<typeof compute>, el: number, prop: PropertyName) {
  return result.elements.find((e) => e.elementId === el)!.properties[prop];
}

test('低特异性 important 胜过高特异性普通声明', () => {
  const r = compute({
    elements: [{ id: 1, tag: 'p', parent: null, classes: ['a', 'b', 'c'] }],
    rules: [
      { selector: '.a.b.c', declarations: [{ property: 'color', value: 'red' }] },
      { selector: 'p', declarations: [{ property: 'color', value: 'blue', important: true }] },
    ],
  });
  const p = val(r, 1, 'color');
  assert.equal(p.value, 'blue');
  const loser = p.candidates.find((c) => c.value === 'red')!;
  assert.equal(loser.outcome, 'loser');
  assert.equal(loser.lostReason, 'importance');
});

test('同特异性后者胜出，失败原因为顺序', () => {
  const r = compute({
    elements: [{ id: 1, tag: 'p', parent: null, classes: ['x', 'y'] }],
    rules: [
      { selector: '.x', declarations: [{ property: 'color', value: 'gray' }] },
      { selector: '.y', declarations: [{ property: 'color', value: 'orange' }] },
    ],
  });
  const p = val(r, 1, 'color');
  assert.equal(p.value, 'orange');
  assert.equal(p.candidates.find((c) => c.value === 'gray')!.lostReason, 'order');
});

test('特异性按元组比较：多 class 不超过 id，无进位混淆', () => {
  assert.ok(compareSpecificity([1, 0, 0], [0, 15, 0]) > 0);
  assert.ok(compareSpecificity([0, 2, 0], [0, 1, 5]) > 0);
  const r = compute({
    elements: [{ id: 1, tag: 'p', parent: null, idAttr: 'i', classes: ['a', 'b', 'c', 'd', 'e'] }],
    rules: [
      { selector: '.a.b.c.d.e', declarations: [{ property: 'color', value: 'red' }] },
      { selector: '#i', declarations: [{ property: 'color', value: 'green' }] },
    ],
  });
  assert.equal(val(r, 1, 'color').value, 'green');
});

test('通配符匹配且特异性为零', () => {
  const sel = parseSelector('*');
  assert.deepEqual(sel.specificity, [0, 0, 0]);
  const r = compute({
    elements: [{ id: 1, tag: 'p', parent: null }],
    rules: [
      { selector: '*', declarations: [{ property: 'color', value: 'red' }] },
      { selector: 'p', declarations: [{ property: 'color', value: 'blue' }] },
    ],
  });
  assert.equal(val(r, 1, 'color').value, 'blue');
});

test('行内普通声明胜过样式表普通声明；行内 important 胜过样式表 important', () => {
  const r = compute({
    elements: [
      { id: 1, tag: 'p', parent: null, idAttr: 'a', inline: [{ property: 'color', value: 'purple' }] },
      {
        id: 2,
        tag: 'p',
        parent: null,
        idAttr: 'b',
        inline: [{ property: 'color', value: 'pink', important: true }],
      },
    ],
    rules: [
      { selector: '#a', declarations: [{ property: 'color', value: 'black' }] },
      { selector: '#b', declarations: [{ property: 'color', value: 'black', important: true }] },
    ],
  });
  assert.equal(val(r, 1, 'color').value, 'purple');
  assert.equal(val(r, 2, 'color').value, 'pink');
});

test('规则内同属性重复声明：靠后的同等级声明优先', () => {
  const r = compute({
    elements: [{ id: 1, tag: 'p', parent: null }],
    rules: [
      {
        selector: 'p',
        declarations: [
          { property: 'color', value: 'red' },
          { property: 'color', value: 'blue' },
        ],
      },
    ],
  });
  assert.equal(val(r, 1, 'color').value, 'blue');
});

test('父级 important 不压过子级显式普通值；无显式值时才继承父级计算值', () => {
  const r = compute({
    elements: [
      { id: 1, tag: 'div', parent: null, classes: ['root'] },
      { id: 2, tag: 'em', parent: 1, classes: ['plain'] },
      { id: 3, tag: 'span', parent: 1 },
    ],
    rules: [
      { selector: '.root', declarations: [{ property: 'color', value: 'green', important: true }] },
      { selector: '.plain', declarations: [{ property: 'color', value: 'teal' }] },
    ],
  });
  assert.equal(val(r, 2, 'color').value, 'teal');
  const inherited = val(r, 3, 'color');
  assert.equal(inherited.value, 'green');
  assert.deepEqual(inherited.source, { kind: 'inherited', fromElement: 1 });
});

test('根元素无父值：可继承属性取初始值', () => {
  const r = compute({ elements: [{ id: 1, tag: 'div', parent: null }], rules: [] });
  assert.equal(val(r, 1, 'color').value, INITIAL_VALUES.color);
  assert.equal(val(r, 1, 'color').source.kind, 'initial');
});

test('全局关键字 inherit / initial / unset', () => {
  const r = compute({
    elements: [
      { id: 1, tag: 'div', parent: null, classes: ['root'] },
      { id: 2, tag: 'p', parent: 1, classes: ['a'] },
      { id: 3, tag: 'p', parent: 1, classes: ['b'] },
      { id: 4, tag: 'p', parent: 1, classes: ['c'] },
      { id: 5, tag: 'p', parent: 1, classes: ['d'] },
    ],
    rules: [
      { selector: '.root', declarations: [{ property: 'color', value: 'green' }] },
      { selector: '.a', declarations: [{ property: 'color', value: 'inherit' }] },
      { selector: '.b', declarations: [{ property: 'color', value: 'initial' }] },
      { selector: '.c', declarations: [{ property: 'color', value: 'unset' }] },
      { selector: '.d', declarations: [{ property: 'display', value: 'unset' }] },
    ],
  });
  assert.equal(val(r, 2, 'color').value, 'green'); // inherit -> 父值
  assert.equal(val(r, 3, 'color').value, INITIAL_VALUES.color); // initial
  assert.equal(val(r, 4, 'color').value, 'green'); // unset 可继承 -> 父值
  const d = val(r, 5, 'display');
  assert.equal(d.value, INITIAL_VALUES.display); // unset 不可继承 -> 初始值
  assert.equal(d.source.kind, 'initial');
});

test('非继承属性不继承，取初始值', () => {
  const r = compute({
    elements: [
      { id: 1, tag: 'div', parent: null, classes: ['root'] },
      { id: 2, tag: 'p', parent: 1 },
    ],
    rules: [
      {
        selector: '.root',
        declarations: [
          { property: 'display', value: 'block' },
          { property: 'opacity', value: '0.5' },
        ],
      },
    ],
  });
  assert.equal(val(r, 2, 'display').value, INITIAL_VALUES.display);
  assert.equal(val(r, 2, 'opacity').value, INITIAL_VALUES.opacity);
});

test('空声明列表与空规则列表也是合法输入，返回全属性结果', () => {
  const r = compute({
    elements: [{ id: 1, tag: 'div', parent: null }],
    rules: [{ selector: 'div', declarations: [] }],
  });
  const props = r.elements[0].properties;
  for (const p of ['color', 'font-size', 'text-align', 'display', 'opacity'] as PropertyName[]) {
    assert.equal(props[p].value, INITIAL_VALUES[p]);
  }
});

test('无关规则变化不影响结果；相关规则调序只影响对应属性', () => {
  const base: ComputeInput = {
    elements: [{ id: 1, tag: 'p', parent: null, classes: ['x', 'y'] }],
    rules: [
      { selector: '.x', declarations: [{ property: 'color', value: 'gray' }] },
      { selector: '.y', declarations: [{ property: 'color', value: 'orange' }] },
      { selector: 'p', declarations: [{ property: 'font-size', value: '20px' }] },
    ],
  };
  const withExtra: ComputeInput = {
    ...base,
    rules: [...base.rules, { selector: 'span', declarations: [{ property: 'opacity', value: '0.3' }] }],
  };
  assert.deepEqual(compute(base), compute(withExtra));

  const reordered: ComputeInput = {
    ...base,
    rules: [base.rules[1], base.rules[0], base.rules[2]],
  };
  const a = compute(base);
  const b = compute(reordered);
  assert.equal(val(a, 1, 'color').value, 'orange');
  assert.equal(val(b, 1, 'color').value, 'gray'); // 顺序影响 color
  assert.equal(val(b, 1, 'font-size').value, '20px'); // font-size 不受影响
});

test('参数校验：重复节点 / 坏选择器 / 未知属性 / 空值 / 非法 important / 环', () => {
  const bad = (input: ComputeInput, code: string) => {
    try {
      validateInput(input);
      assert.fail('应当抛出');
    } catch (e) {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, code);
    }
  };
  bad(
    {
      elements: [
        { id: 1, tag: 'div', parent: null },
        { id: 1, tag: 'p', parent: null },
      ],
      rules: [],
    },
    'DUPLICATE_NODE',
  );
  bad(
    { elements: [{ id: 1, tag: 'div', parent: null }], rules: [{ selector: 'div p', declarations: [] }] },
    'BAD_SELECTOR',
  );
  bad(
    { elements: [{ id: 1, tag: 'div', parent: null }], rules: [{ selector: 'div:hover', declarations: [] }] },
    'BAD_SELECTOR',
  );
  bad(
    { elements: [{ id: 1, tag: 'div', parent: null }], rules: [{ selector: 'div, p', declarations: [] }] },
    'BAD_SELECTOR',
  );
  bad(
    {
      elements: [{ id: 1, tag: 'div', parent: null }],
      rules: [{ selector: 'div', declarations: [{ property: 'width', value: '1px' }] }],
    },
    'UNKNOWN_PROPERTY',
  );
  bad(
    {
      elements: [{ id: 1, tag: 'div', parent: null }],
      rules: [{ selector: 'div', declarations: [{ property: 'color', value: ' ' }] }],
    },
    'EMPTY_VALUE',
  );
  bad(
    {
      elements: [{ id: 1, tag: 'div', parent: null }],
      rules: [
        {
          selector: 'div',
          declarations: [{ property: 'color', value: 'red', important: 'yes' as unknown as boolean }],
        },
      ],
    },
    'BAD_IMPORTANT',
  );
  bad(
    {
      elements: [
        { id: 1, tag: 'div', parent: 2 },
        { id: 2, tag: 'div', parent: 1 },
      ],
      rules: [],
    },
    'CYCLE',
  );
  bad(
    { elements: [{ id: 1, tag: 'div', parent: 99 }], rules: [] },
    'BAD_PARENT',
  );
});
