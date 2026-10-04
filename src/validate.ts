import { ApiError } from './errors.js';
import { parseSelector } from './selector.js';
import { PROPERTIES, type ComputeInput, type DeclarationInput } from './types.js';

export const LIMITS = {
  maxElements: 1000,
  maxRules: 500,
  maxDeclarationsPerRule: 100,
  maxInlinePerElement: 100,
  maxValueLength: 500,
};

const PROP_SET = new Set<string>(PROPERTIES);

function validateDeclaration(d: DeclarationInput, where: string): void {
  if (d === null || typeof d !== 'object') {
    throw new ApiError('VALIDATION', `${where}: 声明必须是对象`);
  }
  if (!PROP_SET.has(d.property)) {
    throw new ApiError('UNKNOWN_PROPERTY', `${where}: 未知属性 "${d.property}"，仅支持 ${PROPERTIES.join(', ')}`);
  }
  if (typeof d.value !== 'string' || d.value.trim().length === 0) {
    throw new ApiError('EMPTY_VALUE', `${where}: 属性 ${d.property} 的值不能为空`);
  }
  if (d.value.length > LIMITS.maxValueLength) {
    throw new ApiError('LIMIT_EXCEEDED', `${where}: 值长度超过 ${LIMITS.maxValueLength}`);
  }
  if (d.important !== undefined && typeof d.important !== 'boolean') {
    throw new ApiError('BAD_IMPORTANT', `${where}: important 必须是布尔值`);
  }
}

export function validateInput(input: ComputeInput): void {
  if (input === null || typeof input !== 'object') {
    throw new ApiError('VALIDATION', '输入必须是对象 { elements, rules }');
  }
  const { elements, rules } = input;
  if (!Array.isArray(elements)) throw new ApiError('VALIDATION', 'elements 必须是数组');
  if (!Array.isArray(rules)) throw new ApiError('VALIDATION', 'rules 必须是数组');
  if (elements.length === 0) throw new ApiError('VALIDATION', 'elements 不能为空数组');
  if (elements.length > LIMITS.maxElements) {
    throw new ApiError('LIMIT_EXCEEDED', `元素数量超过上限 ${LIMITS.maxElements}`);
  }
  if (rules.length > LIMITS.maxRules) {
    throw new ApiError('LIMIT_EXCEEDED', `规则数量超过上限 ${LIMITS.maxRules}`);
  }

  const ids = new Set<number>();
  for (const el of elements) {
    if (el === null || typeof el !== 'object') throw new ApiError('VALIDATION', '元素必须是对象');
    if (!Number.isInteger(el.id)) throw new ApiError('VALIDATION', `元素 id 必须是整数: ${JSON.stringify(el.id)}`);
    if (ids.has(el.id)) throw new ApiError('DUPLICATE_NODE', `重复的元素 id: ${el.id}`);
    ids.add(el.id);
    if (typeof el.tag !== 'string' || !/^[A-Za-z][A-Za-z0-9-]*$/.test(el.tag)) {
      throw new ApiError('VALIDATION', `元素 ${el.id} 的 tag 非法`);
    }
    if (el.parent !== null && !Number.isInteger(el.parent)) {
      throw new ApiError('BAD_PARENT', `元素 ${el.id} 的 parent 必须是整数或 null`);
    }
    if (el.idAttr !== undefined && typeof el.idAttr !== 'string') {
      throw new ApiError('VALIDATION', `元素 ${el.id} 的 idAttr 必须是字符串`);
    }
    if (el.classes !== undefined) {
      if (!Array.isArray(el.classes) || el.classes.some((c) => typeof c !== 'string')) {
        throw new ApiError('VALIDATION', `元素 ${el.id} 的 classes 必须是字符串数组`);
      }
    }
    if (el.inline !== undefined) {
      if (!Array.isArray(el.inline)) throw new ApiError('VALIDATION', `元素 ${el.id} 的 inline 必须是数组`);
      if (el.inline.length > LIMITS.maxInlinePerElement) {
        throw new ApiError('LIMIT_EXCEEDED', `元素 ${el.id} 的行内声明超过上限`);
      }
      el.inline.forEach((d, i) => validateDeclaration(d, `元素 ${el.id} 行内声明 #${i}`));
    }
  }

  for (const el of elements) {
    if (el.parent !== null && !ids.has(el.parent)) {
      throw new ApiError('BAD_PARENT', `元素 ${el.id} 的 parent ${el.parent} 不存在`);
    }
    if (el.parent === el.id) throw new ApiError('CYCLE', `元素 ${el.id} 的 parent 指向自身`);
  }
  // 环检测
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const el of elements) {
    const seen = new Set<number>();
    let cur = el;
    while (cur.parent !== null) {
      if (seen.has(cur.id)) throw new ApiError('CYCLE', `元素树存在环（经过元素 ${cur.id}）`);
      seen.add(cur.id);
      cur = byId.get(cur.parent)!;
    }
  }

  rules.forEach((rule, ri) => {
    if (rule === null || typeof rule !== 'object') throw new ApiError('VALIDATION', `规则 #${ri} 必须是对象`);
    parseSelector(rule.selector); // 非法选择器在此抛出 BAD_SELECTOR
    if (!Array.isArray(rule.declarations)) {
      throw new ApiError('VALIDATION', `规则 #${ri} 的 declarations 必须是数组`);
    }
    if (rule.declarations.length > LIMITS.maxDeclarationsPerRule) {
      throw new ApiError('LIMIT_EXCEEDED', `规则 #${ri} 的声明数量超过上限`);
    }
    rule.declarations.forEach((d, di) => validateDeclaration(d, `规则 #${ri} 声明 #${di}`));
  });
}
