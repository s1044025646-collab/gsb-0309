import type {
  AuthorRule,
  ComputeInput,
  Declaration,
  ElementNode,
  Specificity,
} from './types.js';
import { PROPERTIES } from './types.js';

/** 算法版本：层叠/继承语义变更时必须提升，旧报告仍可从 SQLite 读取解释。 */
export const ALGORITHM_VERSION = 'cascade-1.0.0';

/** 规模限制（可在调用处覆盖）。 */
export interface Limits {
  maxElements: number;
  maxRules: number;
  maxDeclarationsPerRule: number;
  maxClassesPerSelector: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxElements: 1000,
  maxRules: 2000,
  maxDeclarationsPerRule: 200,
  maxClassesPerSelector: 64,
};

/** 参数校验错误：携带稳定错误码，便于 API/CLI 输出。 */
export class ValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

export interface ParsedSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
  specificity: Specificity;
}

const IDENT = /^[A-Za-z0-9_-]+$/;
const IDENT_START = /^[A-Za-z_-]/;

function isIdent(s: string): boolean {
  return s.length > 0 && IDENT_START.test(s) && IDENT.test(s);
}

/**
 * 解析单个复合选择器（不含空格）：
 * 可选标签或 *，最多一个 #id，任意个 .class，顺序任意但每段只允许这些成分。
 * 明确拒绝后代选择器（空格）、属性选择器 []、伪类 :、选择器列表 ,、层叠层 @layer 等。
 */
export function parseSelector(raw: string): ParsedSelector {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ValidationError('SELECTOR_EMPTY', '选择器不能为空');
  }
  if (/\s/.test(raw)) {
    throw new ValidationError(
      'SELECTOR_DESCENDANT_UNSUPPORTED',
      `不支持后代/组合选择器（含空格）: "${raw}"`,
    );
  }
  if (raw.includes(',')) {
    throw new ValidationError('SELECTOR_LIST_UNSUPPORTED', `不支持选择器列表: "${raw}"`);
  }
  if (raw.includes('[') || raw.includes(']')) {
    throw new ValidationError('SELECTOR_ATTRIBUTE_UNSUPPORTED', `不支持属性选择器: "${raw}"`);
  }
  if (raw.includes(':') || raw.includes('::')) {
    throw new ValidationError('SELECTOR_PSEUDO_UNSUPPORTED', `不支持伪类/伪元素: "${raw}"`);
  }
  if (raw.includes('>') || raw.includes('+') || raw.includes('~')) {
    throw new ValidationError('SELECTOR_COMBINATOR_UNSUPPORTED', `不支持组合器: "${raw}"`);
  }
  if (raw.includes('@')) {
    throw new ValidationError('SELECTOR_LAYER_UNSUPPORTED', `不支持层叠层/at 规则: "${raw}"`);
  }

  let tag: string | null = null;
  let id: string | null = null;
  const classes: string[] = [];

  let i = 0;
  if (raw[i] === '*') {
    tag = '*';
    i = 1;
  } else if (/[A-Za-z_-]/.test(raw[i] ?? '')) {
    let j = i;
    while (j < raw.length && /[A-Za-z0-9_-]/.test(raw[j] ?? '')) j++;
    tag = raw.slice(i, j);
    i = j;
  }

  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '#') {
      if (id !== null) {
        throw new ValidationError('SELECTOR_MULTIPLE_IDS', `选择器最多包含一个 id: "${raw}"`);
      }
      let j = i + 1;
      while (j < raw.length && /[A-Za-z0-9_-]/.test(raw[j] ?? '')) j++;
      const name = raw.slice(i + 1, j);
      if (!isIdent(name)) {
        throw new ValidationError('SELECTOR_BAD_IDENTIFIER', `选择器 id 非法: "${raw}"`);
      }
      id = name;
      i = j;
    } else if (ch === '.') {
      let j = i + 1;
      while (j < raw.length && /[A-Za-z0-9_-]/.test(raw[j] ?? '')) j++;
      const name = raw.slice(i + 1, j);
      if (!isIdent(name)) {
        throw new ValidationError('SELECTOR_BAD_IDENTIFIER', `选择器 class 非法: "${raw}"`);
      }
      classes.push(name);
      i = j;
    } else {
      throw new ValidationError('SELECTOR_MALFORMED', `选择器包含非法字符: "${raw}"`);
    }
  }

  if (tag === null && id === null && classes.length === 0) {
    throw new ValidationError('SELECTOR_MALFORMED', `选择器缺少成分: "${raw}"`);
  }

  return {
    tag,
    id,
    classes,
    specificity: {
      id: id ? 1 : 0,
      class: classes.length,
      type: tag && tag !== '*' ? 1 : 0,
    },
  };
}

/** 选择器是否匹配元素（本项目子集：tag / * / id / class 集合相等性）。 */
export function selectorMatches(sel: ParsedSelector, el: ElementNode): boolean {
  if (sel.tag !== null && sel.tag !== '*' && sel.tag !== el.tag) return false;
  if (sel.id !== null && sel.id !== (el.elementId ?? null)) return false;
  if (sel.classes.length > 0) {
    const elClasses = new Set(el.classes ?? []);
    for (const c of sel.classes) if (!elClasses.has(c)) return false;
  }
  return true;
}

function validateDeclaration(d: Declaration, ctx: string): void {
  if (d === null || typeof d !== 'object') {
    throw new ValidationError('DECLARATION_INVALID', `${ctx} 声明必须是对象`);
  }
  if (typeof d.property !== 'string' || !(PROPERTIES as readonly string[]).includes(d.property)) {
    throw new ValidationError(
      'UNKNOWN_PROPERTY',
      `${ctx} 未知或非法属性: ${String(d.property)}（仅支持 ${PROPERTIES.join(', ')}）`,
    );
  }
  if (typeof d.value !== 'string' || d.value.trim().length === 0) {
    throw new ValidationError('EMPTY_VALUE', `${ctx} 属性 ${d.property} 的值不能为空`);
  }
  if (
    d.important !== undefined &&
    d.important !== null &&
    typeof d.important !== 'boolean'
  ) {
    throw new ValidationError(
      'BAD_IMPORTANT_FLAG',
      `${ctx} 属性 ${d.property} 的 important 标记必须是布尔值`,
    );
  }
}

export interface ValidatedInput {
  tree: ElementNode[];
  rules: AuthorRule[];
  parsedRules: { rule: AuthorRule; parsed: ReturnType<typeof parseSelector> }[];
  inline: Record<string, Record<string, Declaration[]>>;
  /** 子 -> 父 映射。 */
  parentOf: Map<string, string | null>;
  /** 父 -> 子 列表。 */
  childrenOf: Map<string, string[]>;
  rootIds: string[];
}

/** 全量校验输入，并产出解析/拓扑结构。任何错误都抛出（不会产生半份结果）。 */
export function validateInput(input: unknown, limits: Limits = DEFAULT_LIMITS): ValidatedInput {
  if (input === null || typeof input !== 'object') {
    throw new ValidationError('INPUT_INVALID', '请求体必须是 JSON 对象');
  }
  const body = input as ComputeInput;
  if (!Array.isArray(body.tree)) {
    throw new ValidationError('TREE_INVALID', 'tree 必须是数组');
  }
  if (!Array.isArray(body.rules)) {
    throw new ValidationError('RULES_INVALID', 'rules 必须是数组');
  }
  if (body.tree.length > limits.maxElements) {
    throw new ValidationError('LIMIT_EXCEEDED', `元素数量超过上限 ${limits.maxElements}`);
  }
  if (body.rules.length > limits.maxRules) {
    throw new ValidationError('LIMIT_EXCEEDED', `规则数量超过上限 ${limits.maxRules}`);
  }

  const seen = new Set<string>();
  const nodes = new Map<string, ElementNode>();
  for (const el of body.tree) {
    if (el === null || typeof el !== 'object') {
      throw new ValidationError('NODE_INVALID', '元素必须是对象');
    }
    if (typeof el.id !== 'string' || el.id.length === 0) {
      throw new ValidationError('NODE_ID_INVALID', '元素编号必须是非空字符串');
    }
    if (seen.has(el.id)) {
      throw new ValidationError('DUPLICATE_NODE', `重复的元素编号: ${el.id}`);
    }
    if (typeof el.tag !== 'string' || el.tag.length === 0) {
      throw new ValidationError('NODE_TAG_INVALID', `元素 ${el.id} 缺少标签名`);
    }
    if (el.elementId !== undefined && el.elementId !== null && typeof el.elementId !== 'string') {
      throw new ValidationError('NODE_IDATTR_INVALID', `元素 ${el.id} 的 id 必须是字符串或 null`);
    }
    if (el.classes !== undefined) {
      if (!Array.isArray(el.classes) || el.classes.some((c) => typeof c !== 'string')) {
        throw new ValidationError('NODE_CLASSES_INVALID', `元素 ${el.id} 的 classes 必须是字符串数组`);
      }
    }
    if (
      el.parent !== undefined &&
      el.parent !== null &&
      typeof el.parent !== 'string'
    ) {
      throw new ValidationError('NODE_PARENT_INVALID', `元素 ${el.id} 的 parent 必须是编号或 null`);
    }
    seen.add(el.id);
    nodes.set(el.id, el);
  }

  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, string[]>();
  const rootIds: string[] = [];
  for (const el of body.tree) {
    const p = el.parent ?? null;
    if (p !== null && !nodes.has(p)) {
      throw new ValidationError('PARENT_NOT_FOUND', `元素 ${el.id} 引用了不存在的父节点: ${p}`);
    }
    parentOf.set(el.id, p);
    if (p === null) {
      rootIds.push(el.id);
    } else {
      const list = childrenOf.get(p) ?? [];
      list.push(el.id);
      childrenOf.set(p, list);
    }
  }

  // 环检测：从每个节点向上走，带访问标记；父引用必须无环（且最终可达根）。
  for (const startId of nodes.keys()) {
    const path = new Set<string>();
    let cur: string | null = startId;
    while (cur !== null) {
      if (path.has(cur)) {
        throw new ValidationError('TREE_CYCLE', `父引用存在环，涉及节点: ${cur}`);
      }
      path.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }
  if (rootIds.length === 0 && body.tree.length > 0) {
    throw new ValidationError('TREE_NO_ROOT', '元素树没有根节点');
  }

  const parsedRules: ValidatedInput['parsedRules'] = [];
  body.rules.forEach((rule, idx) => {
    const ctx = `规则 #${idx}`;
    if (rule === null || typeof rule !== 'object') {
      throw new ValidationError('RULE_INVALID', `${ctx} 必须是对象`);
    }
    if (!Array.isArray(rule.declarations)) {
      throw new ValidationError('DECLARATIONS_INVALID', `${ctx} 的 declarations 必须是数组`);
    }
    if (rule.declarations.length > limits.maxDeclarationsPerRule) {
      throw new ValidationError('LIMIT_EXCEEDED', `${ctx} 声明数量超过上限`);
    }
    const parsed = parseSelector(rule.selector);
    if (parsed.classes.length > limits.maxClassesPerSelector) {
      throw new ValidationError('LIMIT_EXCEEDED', `${ctx} class 数量超过上限`);
    }
    rule.declarations.forEach((d) => validateDeclaration(d, ctx));
    parsedRules.push({ rule, parsed });
  });

  const inline: ValidatedInput['inline'] = {};
  if (body.inline !== undefined && body.inline !== null) {
    if (typeof body.inline !== 'object') {
      throw new ValidationError('INLINE_INVALID', 'inline 必须是以元素编号为键的对象');
    }
    for (const [elId, decls] of Object.entries(body.inline)) {
      if (!nodes.has(elId)) {
        throw new ValidationError('INLINE_NODE_NOT_FOUND', `行内声明引用了不存在的元素: ${elId}`);
      }
      if (decls === null || typeof decls !== 'object' || Array.isArray(decls)) {
        throw new ValidationError('INLINE_INVALID', `元素 ${elId} 的行内声明必须是以属性为键的对象`);
      }
      const perProp: Record<string, Declaration[]> = {};
      for (const [prop, list] of Object.entries(decls)) {
        if (!Array.isArray(list)) {
          throw new ValidationError('INLINE_INVALID', `元素 ${elId} 属性 ${prop} 的声明必须是数组`);
        }
        list.forEach((d, j) => validateDeclaration(d, `元素 ${elId} 行内 ${prop}[${j}]`));
        perProp[prop] = list;
      }
      inline[elId] = perProp;
    }
  }

  return {
    tree: body.tree,
    rules: body.rules,
    parsedRules,
    inline,
    parentOf,
    childrenOf,
    rootIds,
  };
}
