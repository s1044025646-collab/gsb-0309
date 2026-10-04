import type { ComputeInput } from './types.js';

/**
 * 演示场景：
 *  - 元素 2：低特异性 important（.imp）胜过高特异性普通声明（.a.b.c）
 *  - 元素 3：同特异性时后者胜出（.x 与 .y 同特异性，.y 在后）
 *  - 元素 4：行内普通声明胜过样式表高特异性普通声明
 *  - 元素 5：父级（元素 1）color: green !important 不会压过子级显式普通值
 */
export function buildDemoInput(): ComputeInput {
  return {
    elements: [
      { id: 1, tag: 'div', parent: null, classes: ['root'] },
      { id: 2, tag: 'p', parent: 1, classes: ['a', 'b', 'c', 'imp'] },
      { id: 3, tag: 'p', parent: 1, classes: ['x', 'y'] },
      { id: 4, tag: 'span', parent: 1, idAttr: 's4', inline: [{ property: 'color', value: 'purple' }] },
      { id: 5, tag: 'em', parent: 1, classes: ['plain'] },
    ],
    rules: [
      { selector: '.a.b.c', declarations: [{ property: 'color', value: 'red' }] },
      { selector: '.imp', declarations: [{ property: 'color', value: 'blue', important: true }] },
      { selector: '.x', declarations: [{ property: 'color', value: 'gray' }] },
      { selector: '.y', declarations: [{ property: 'color', value: 'orange' }] },
      { selector: '#s4', declarations: [{ property: 'color', value: 'black' }] },
      { selector: '.root', declarations: [{ property: 'color', value: 'green', important: true }] },
      { selector: '.plain', declarations: [{ property: 'color', value: 'teal' }] },
      { selector: 'p', declarations: [{ property: 'font-size', value: '20px' }] },
    ],
  };
}
