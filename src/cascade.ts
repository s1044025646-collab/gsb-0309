import { matches, parseSelector, compareSpecificity, type Specificity } from './selector.js';
import {
  ALGO_VERSION,
  GLOBAL_KEYWORDS,
  INHERITED_PROPERTIES,
  INITIAL_VALUES,
  PROPERTIES,
  type CandidateTrace,
  type ComputeInput,
  type ComputeResult,
  type ElementInput,
  type ElementResult,
  type FinalSource,
  type LoseReason,
  type PropertyName,
  type PropertyResult,
} from './types.js';

interface Candidate {
  source: 'rule' | 'inline';
  ruleIndex?: number;
  selector?: string;
  declarationIndex: number;
  important: boolean;
  specificity: Specificity | null;
  value: string;
  order: number; // 全局出现顺序（规则序 + 规则内声明序；行内按声明序）
}

/** 重要性层级：普通规则 < 普通行内 < important 规则 < important 行内 */
function tier(c: Candidate): number {
  if (!c.important) return c.source === 'inline' ? 1 : 0;
  return c.source === 'inline' ? 3 : 2;
}

/** 返回正数表示 a 胜；同时记录输家原因 */
function compareCandidates(a: Candidate, b: Candidate): { cmp: number; reason: LoseReason } {
  const ta = tier(a);
  const tb = tier(b);
  if (ta !== tb) return { cmp: ta - tb, reason: 'importance' };
  if (a.specificity && b.specificity) {
    const s = compareSpecificity(a.specificity, b.specificity);
    if (s !== 0) return { cmp: s, reason: 'specificity' };
  }
  return { cmp: a.order - b.order, reason: 'order' };
}

function toTrace(c: Candidate): CandidateTrace {
  return {
    source: c.source,
    ruleIndex: c.ruleIndex,
    selector: c.selector,
    declarationIndex: c.declarationIndex,
    important: c.important,
    specificity: c.specificity,
    value: c.value,
    outcome: 'loser',
  };
}

export function computeStyles(input: ComputeInput): ComputeResult {
  const byId = new Map<number, ElementInput>();
  for (const el of input.elements) byId.set(el.id, el);

  const parsedRules = input.rules.map((r) => ({
    selector: parseSelector(r.selector),
    declarations: r.declarations,
  }));

  const memo = new Map<number, ElementResult>();

  function computeElement(el: ElementInput): ElementResult {
    const cached = memo.get(el.id);
    if (cached) return cached;
    const parentResult = el.parent !== null ? computeElement(byId.get(el.parent)!) : null;

    const properties = {} as Record<PropertyName, PropertyResult>;
    for (const prop of PROPERTIES) {
      properties[prop] = computeProperty(el, prop, parentResult);
    }
    const result: ElementResult = { elementId: el.id, properties };
    memo.set(el.id, result);
    return result;
  }

  function computeProperty(
    el: ElementInput,
    prop: PropertyName,
    parentResult: ElementResult | null,
  ): PropertyResult {
    // 1. 收集候选：仅本元素命中的规则声明 + 本元素行内声明。
    //    继承在候选为空或 inherit/unset 时单独处理，绝不把父样式混入竞争。
    const candidates: Candidate[] = [];
    let order = 0;
    parsedRules.forEach((rule, ruleIndex) => {
      if (!matches(rule.selector, el)) return;
      rule.declarations.forEach((d, declarationIndex) => {
        if (d.property !== prop) return;
        candidates.push({
          source: 'rule',
          ruleIndex,
          selector: rule.selector.raw,
          declarationIndex,
          important: d.important === true,
          specificity: rule.selector.specificity,
          value: d.value,
          order: order++,
        });
      });
    });
    (el.inline ?? []).forEach((d, declarationIndex) => {
      if (d.property !== prop) return;
      candidates.push({
        source: 'inline',
        declarationIndex,
        important: d.important === true,
        specificity: null,
        value: d.value,
        order: order++,
      });
    });

    // 2. 决胜
    let winner: Candidate | null = null;
    const traces: CandidateTrace[] = [];
    for (const c of candidates) {
      if (winner === null) {
        winner = c;
        continue;
      }
      const { cmp, reason } = compareCandidates(c, winner);
      if (cmp > 0) {
        const t = toTrace(winner);
        t.lostReason = reason;
        traces.push(t);
        winner = c;
      } else {
        const t = toTrace(c);
        t.lostReason = reason;
        traces.push(t);
      }
    }

    // 3. 解析关键字 / 继承 / 初始值
    const inheritedValue = (): { value: string; source: FinalSource } =>
      parentResult
        ? {
            value: parentResult.properties[prop].value,
            source: { kind: 'inherited', fromElement: el.parent! },
          }
        : { value: INITIAL_VALUES[prop], source: { kind: 'initial' } };

    let value: string;
    let source: FinalSource;
    let keyword: PropertyResult['keyword'] = null;

    if (winner === null) {
      if (INHERITED_PROPERTIES.has(prop) && parentResult) {
        ({ value, source } = inheritedValue());
      } else {
        value = INITIAL_VALUES[prop];
        source = { kind: 'initial' };
      }
    } else {
      const raw = winner.value.trim().toLowerCase();
      const winSource: FinalSource =
        winner.source === 'inline'
          ? { kind: 'inline', important: winner.important }
          : {
              kind: 'rule',
              ruleIndex: winner.ruleIndex!,
              selector: winner.selector!,
              important: winner.important,
            };
      if (GLOBAL_KEYWORDS.has(raw)) {
        keyword = raw as PropertyResult['keyword'];
        if (raw === 'initial') {
          value = INITIAL_VALUES[prop];
          source = { kind: 'initial' };
        } else if (raw === 'inherit') {
          ({ value, source } = inheritedValue());
        } else {
          // unset：可继承属性取父值，否则取初始值
          if (INHERITED_PROPERTIES.has(prop)) ({ value, source } = inheritedValue());
          else {
            value = INITIAL_VALUES[prop];
            source = { kind: 'initial' };
          }
        }
      } else {
        value = winner.value;
        source = winSource;
      }
    }

    const winTrace = winner ? toTrace(winner) : null;
    if (winTrace) winTrace.outcome = 'winner';
    const orderedTraces = winTrace ? [...traces, winTrace] : traces;

    return { property: prop, value, keyword, source, candidates: orderedTraces };
  }

  const elements = input.elements.map((el) => computeElement(el));
  return { algoVersion: ALGO_VERSION, elements };
}
