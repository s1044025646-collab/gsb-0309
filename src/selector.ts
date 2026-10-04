import { ApiError } from './errors.js';
import type { ElementInput } from './types.js';

export type Specificity = [number, number, number]; // [id数, class数, 标签数]

export interface ParsedSelector {
  raw: string;
  tag: string | null; // null 表示无标签部分；'*' 表示通配符
  id: string | null;
  classes: string[];
  specificity: Specificity;
}

const IDENT = '[A-Za-z_][A-Za-z0-9_-]*';
const RE = new RegExp(`^(\\*|${IDENT})?(#${IDENT})?((?:\\.${IDENT})*)$`);

export function parseSelector(raw: string): ParsedSelector {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ApiError('BAD_SELECTOR', '选择器不能为空');
  }
  if (/[\s>+~\[\]:,]/.test(raw)) {
    throw new ApiError(
      'BAD_SELECTOR',
      `不支持的选择器（仅允许单个复合选择器：可选标签/通配符 + 最多一个 id + 任意个 class）: "${raw}"`,
    );
  }
  const m = RE.exec(raw);
  if (!m || (!m[1] && !m[2] && !m[3])) {
    throw new ApiError('BAD_SELECTOR', `非法选择器: "${raw}"`);
  }
  const classes = m[3] ? m[3].slice(1).split('.') : [];
  const tag = m[1] ?? null;
  const specificity: Specificity = [
    m[2] ? 1 : 0,
    classes.length,
    tag && tag !== '*' ? 1 : 0,
  ];
  return { raw, tag, id: m[2] ? m[2].slice(1) : null, classes, specificity };
}

export function matches(sel: ParsedSelector, el: ElementInput): boolean {
  if (sel.tag && sel.tag !== '*' && sel.tag.toLowerCase() !== el.tag.toLowerCase()) return false;
  if (sel.id && sel.id !== el.idAttr) return false;
  const elClasses = el.classes ?? [];
  for (const c of sel.classes) {
    if (!elClasses.includes(c)) return false;
  }
  return true;
}

/** 字典序比较特异性元组：a>b 返回正数 */
export function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}
