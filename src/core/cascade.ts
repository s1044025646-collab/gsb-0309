import type {
  Candidate,
  ComputeReport,
  ElementNode,
  LossReason,
  LoserRecord,
  PropertyName,
  PropertyResolution,
  Specificity,
} from './types.js';
import {
  GLOBAL_KEYWORDS,
  INHERITED_PROPERTIES,
  INITIAL_VALUES,
  PROPERTIES,
  type GlobalKeyword,
} from './types.js';
import { ALGORITHM_VERSION, selectorMatches, validateInput, type ValidatedInput } from './validate.js';

/**
 * 候选比较：严格按 (重要性, 特异性层级, 特异性, 顺序) 决胜。
 *
 * 关键设计：
 * 1. 继承根本不进入候选竞争。父元素的样式不会被当成一条高优先级子规则混入，
 *    因此“父元素 important”不可能压过子元素自己的普通声明。
 * 2. 同一重要级别下行内优先：行内是独立的特异性层级（inline=1），记录为
 *    specificity 层的胜负（含层级说明），而不是靠伪造大整数。
 * 3. 样式表特异性按 (id, class, type) 元组逐位比较，绝不拼接成小整数。
 */

/** 比较结果：>0 表示 a 胜出，<0 表示 b 胜出。 */
export function compareCandidates(a: Candidate, b: Candidate): number {
  // 第 1 层：important 优先于所有普通声明。
  if (a.important !== b.important) return a.important ? 1 : -1;

  // 第 2 层：同一重要级别下，行内声明优先于样式表声明（行内 important 高于规则 important）。
  const aInline = a.origin === 'inline' ? 1 : 0;
  const bInline = b.origin === 'inline' ? 1 : 0;
  if (aInline !== bInline) return aInline > bInline ? 1 : -1;

  // 第 3 层：样式表规则按特异性元组比较（行内候选 specificity 为 null，已在上一层区分）。
  const c = compareSpecificity(a.specificity, b.specificity);
  if (c !== 0) return c;

  // 第 4 层：出现顺序，靠后优先。
  const orderA = a.ruleIndex * 1_000_000 + a.declIndex;
  const orderB = b.ruleIndex * 1_000_000 + b.declIndex;
  return orderA > orderB ? 1 : orderA < orderB ? -1 : 0;
}

export function compareSpecificity(a: Specificity | null, b: Specificity | null): number {
  const za: Specificity = a ?? { id: 0, class: 0, type: 0 };
  const zb: Specificity = b ?? { id: 0, class: 0, type: 0 };
  if (za.id !== zb.id) return za.id > zb.id ? 1 : -1;
  if (za.class !== zb.class) return za.class > zb.class ? 1 : -1;
  if (za.type !== zb.type) return za.type > zb.type ? 1 : -1;
  return 0;
}

/** 判定在比较中败方输在哪一层（用于解释）。 */
export function explainLoss(winner: Candidate, loser: Candidate): LossReason {
  if (winner.important !== loser.important) return 'importance';
  const wInline = winner.origin === 'inline';
  const lInline = loser.origin === 'inline';
  if (wInline !== lInline) return 'specificity'; // 行内优先属于“特异性/来源层级”层
  if (compareSpecificity(winner.specificity, loser.specificity) !== 0) return 'specificity';
  return 'order';
}

function globalKeyword(value: string): GlobalKeyword | null {
  return (GLOBAL_KEYWORDS as readonly string[]).includes(value) ? (value as GlobalKeyword) : null;
}

function describeCandidate(c: Candidate): string {
  const imp = c.important ? ' !important' : '';
  if (c.origin === 'inline') {
    return `行内声明[${c.declIndex}] ${c.property}: ${c.value}${imp}`;
  }
  return `规则#${c.ruleIndex} 选择器"${c.selector}" 声明[${c.declIndex}] ${c.property}: ${c.value}${imp}`;
}

/** 收集某元素某属性的全部直接候选（匹配规则 + 行内）。不包含继承。 */
function collectCandidates(
  el: ElementNode,
  property: PropertyName,
  validated: ValidatedInput,
): Candidate[] {
  const candidates: Candidate[] = [];

  validated.parsedRules.forEach(({ rule, parsed }, ruleIndex) => {
    if (!selectorMatches(parsed, el)) return;
    rule.declarations.forEach((d, declIndex) => {
      if (d.property !== property) return;
      candidates.push({
        origin: 'rule',
        ruleIndex,
        declIndex,
        selector: rule.selector,
        specificity: parsed.specificity,
        property,
        value: d.value,
        important: d.important ?? false,
        global: globalKeyword(d.value),
      });
    });
  });

  const inlineLists = validated.inline[el.id];
  if (inlineLists) {
    const list = inlineLists[property];
    if (list) {
      list.forEach((d, declIndex) => {
        candidates.push({
          origin: 'inline',
          ruleIndex: -1,
          declIndex,
          selector: null,
          specificity: null,
          property,
          value: d.value,
          important: d.important ?? false,
          global: globalKeyword(d.value),
        });
      });
    }
  }

  return candidates;
}

/** 在候选集合中自行做两两比较，返回胜出者与完整淘汰记录。 */
function runCascade(candidates: Candidate[]): {
  winner: Candidate | null;
  losers: LoserRecord[];
} {
  let winner: Candidate | null = null;
  const losers: LoserRecord[] = [];
  for (const cand of candidates) {
    if (winner === null) {
      winner = cand;
      continue;
    }
    if (compareCandidates(cand, winner) > 0) {
      losers.push({ loser: winner, winner: cand, reason: explainLoss(cand, winner) });
      winner = cand;
    } else {
      losers.push({ loser: cand, winner, reason: explainLoss(winner, cand) });
    }
  }
  return { winner, losers };
}

/** 拓扑顺序：父先于子。父引用已校验合法无环。 */
function topoOrder(validated: ValidatedInput): string[] {
  const order: string[] = [];
  const visit = (id: string): void => {
    order.push(id);
    for (const child of validated.childrenOf.get(id) ?? []) visit(child);
  };
  for (const rootId of validated.rootIds) visit(rootId);
  return order;
}

const REASON_LABEL: Record<LossReason, string> = {
  importance: '重要性（important 等级更低）',
  specificity: '特异性/来源层级（行内或选择器特异性更低）',
  order: '顺序（同特异性时出现得更早）',
};

/**
 * 计算整棵树。一次失败直接抛出，由上层保证绝不保存“部分元素集合”。
 */
export function compute(input: unknown): ComputeReport {
  const validated = validateInput(input);
  const nodes = new Map(validated.tree.map((el) => [el.id, el]));
  const order = topoOrder(validated);

  const result: ComputeReport['elements'] = {};

  for (const id of order) {
    const el = nodes.get(id)!;
    const parentId = validated.parentOf.get(id) ?? null;
    const properties = {} as Record<PropertyName, PropertyResolution>;

    for (const property of PROPERTIES) {
      const inherited = INHERITED_PROPERTIES.has(property);
      const initial = INITIAL_VALUES[property];
      const candidates = collectCandidates(el, property, validated);
      const { winner, losers } = runCascade(candidates);

      const chain: string[] = [];
      if (candidates.length > 0) {
        chain.push(`收集到 ${candidates.length} 个本元素直接候选：`);
        for (const c of candidates) chain.push(`  - ${describeCandidate(c)}`);
      } else {
        chain.push('本元素没有任何直接候选（不把父样式当作候选混入竞争）。');
      }

      const base: PropertyResolution = {
        property,
        value: initial,
        source: 'initial',
        chain,
        candidates,
        losers,
        initial,
      };

      if (winner) {
        chain.push(
          `层叠胜出：${describeCandidate(winner)}` +
            (losers.length > 0
              ? `；淘汰 ${losers.length} 个候选：` +
                losers
                  .map((l) => `\n    ✗ ${describeCandidate(l.loser)} → 输在${REASON_LABEL[l.reason]}`)
                  .join('')
              : ''),
        );

        if (winner.global === 'initial') {
          chain.push(`值为全局关键字 initial → 使用公布初始值 ${initial}。`);
          properties[property] = {
            ...base,
            source: 'initial',
            winner,
            value: initial,
          };
        } else if (winner.global === 'inherit') {
          if (parentId !== null) {
            const pv = result[parentId]!.properties[property]!;
            chain.push(`值为 inherit → 显式继承父元素 ${parentId} 的计算值 ${pv.value}。`);
            properties[property] = {
              ...base,
              source: 'inherited',
              declaredBy: winner.origin,
              ruleIndex: winner.origin === 'rule' ? winner.ruleIndex : undefined,
              declIndex: winner.declIndex,
              selector: winner.selector,
              important: winner.important,
              winner,
              value: pv.value,
              inheritedFrom: parentId,
            };
          } else {
            chain.push(`根元素无父值可继承 → 回退到初始值 ${initial}。`);
            properties[property] = { ...base, source: 'initial', winner, value: initial };
          }
        } else if (winner.global === 'unset') {
          if (inherited && parentId !== null) {
            const pv = result[parentId]!.properties[property]!;
            chain.push(
              `值为 unset；${property} 可继承 → 取父元素 ${parentId} 的值 ${pv.value}。`,
            );
            properties[property] = {
              ...base,
              source: 'inherited',
              declaredBy: winner.origin,
              ruleIndex: winner.origin === 'rule' ? winner.ruleIndex : undefined,
              declIndex: winner.declIndex,
              selector: winner.selector,
              important: winner.important,
              winner,
              value: pv.value,
              inheritedFrom: parentId,
            };
          } else if (inherited && parentId === null) {
            chain.push(`值为 unset；可继承但根元素无父值 → 采用初始值 ${initial}。`);
            properties[property] = { ...base, source: 'initial', winner, value: initial };
          } else {
            chain.push(`值为 unset；${property} 不继承 → 采用初始值 ${initial}。`);
            properties[property] = { ...base, source: 'initial', winner, value: initial };
          }
        } else {
          properties[property] = {
            ...base,
            source: 'declared',
            declaredBy: winner.origin,
            ruleIndex: winner.origin === 'rule' ? winner.ruleIndex : undefined,
            declIndex: winner.declIndex,
            selector: winner.selector,
            important: winner.important,
            winner,
            value: winner.value,
          };
        }
      } else if (inherited && parentId !== null) {
        const pv = result[parentId]!.properties[property]!;
        chain.push(
          `无直接候选且 ${property} 可继承 → 继承父元素 ${parentId} 的计算值 ${pv.value}（继承与层叠分离，不比较重要性）。`,
        );
        properties[property] = {
          ...base,
          source: 'inherited',
          value: pv.value,
          inheritedFrom: parentId,
        };
      } else if (inherited && parentId === null) {
        chain.push(`根元素无直接候选且无父值 → 采用初始值 ${initial}。`);
        properties[property] = base;
      } else {
        chain.push(`无直接候选且 ${property} 不继承 → 采用初始值 ${initial}。`);
        properties[property] = base;
      }
    }

    result[id] = { elementId: id, tag: el.tag, properties };
  }

  return { algorithmVersion: ALGORITHM_VERSION, elements: result };
}
