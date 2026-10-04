/**
 * 核心数据类型定义。
 * 规则只接受对象形式（不解析 CSS 源码）。
 */

/** 固定支持的五个属性。 */
export const PROPERTIES = ['color', 'font-size', 'text-align', 'display', 'opacity'] as const;
export type PropertyName = (typeof PROPERTIES)[number];

/** 可继承属性（前三个）。 */
export const INHERITED_PROPERTIES: ReadonlySet<PropertyName> = new Set<PropertyName>([
  'color',
  'font-size',
  'text-align',
]);

/** 每个属性公布的初始值（简单字面值，不计算）。 */
export const INITIAL_VALUES: Record<PropertyName, string> = {
  color: 'canvastext',
  'font-size': 'medium',
  'text-align': 'start',
  display: 'inline',
  opacity: '1',
};

export const GLOBAL_KEYWORDS = ['inherit', 'initial', 'unset'] as const;
export type GlobalKeyword = (typeof GLOBAL_KEYWORDS)[number];

/** 选择器特异性：(id 数, class 数, 标签数)，按元组逐位比较，绝不拼接成小整数。 */
export interface Specificity {
  id: number;
  class: number;
  type: number;
}

export interface ElementNode {
  /** 元素唯一编号（非空字符串）。 */
  id: string;
  tag: string;
  elementId?: string | null;
  classes?: string[];
  /** 父元素编号；根元素省略或为 null。 */
  parent?: string | null;
}

export interface Declaration {
  property: string;
 value: string;
  /** 是否带 !important；缺省视为 false，非布尔值判为非法输入。 */
  important?: boolean;
}

export interface AuthorRule {
  /** 单个复合选择器（不含空格），如 div#a.b.c；null/缺省判为非法。 */
  selector: string;
  /** 声明列表，允许同一属性多次出现；可以为空数组。 */
  declarations: Declaration[];
}

/** 某元素的行内声明（属性 -> 声明列表，同属性多次靠后者优先）。 */
export type InlineDeclarations = Record<string, Declaration[]>;

export interface ComputeInput {
  tree: ElementNode[];
  rules: AuthorRule[];
  /** 键为元素编号。 */
  inline?: Record<string, InlineDeclarations>;
}

/** 候选来源类型。 */
export type CandidateOrigin = 'rule' | 'inline';

/** 参与层叠比较的一个候选声明。 */
export interface Candidate {
  origin: CandidateOrigin;
  /** 样式表规则序号（rules 数组下标）；行内候选为 -1。 */
  ruleIndex: number;
  /** 规则内声明序号；行内声明为其在行内列表中的下标。 */
  declIndex: number;
  selector: string | null;
  specificity: Specificity | null;
  property: PropertyName;
  value: string;
  important: boolean;
  /** 原始值是否为全局关键字（用于解析阶段）。 */
  global: GlobalKeyword | null;
}

/** 淘汰原因类别。 */
export type LossReason = 'importance' | 'specificity' | 'order';

export interface LoserRecord {
  loser: Candidate;
  /** 在比较中胜出的候选。 */
  winner: Candidate;
  /** 输在哪一层：重要性 / 特异性 / 顺序。 */
  reason: LossReason;
}

/** 某元素某属性的最终解释。 */
export interface PropertyResolution {
  property: PropertyName;
  value: string;
  /**
   * 最终值来源链：
   * - declared: 由本元素直接声明胜出（可能含 important 行内/规则）
   * - inherited: 取父元素计算值（显式 inherit，或可继承属性无声明）
   * - initial: 取初始值（显式 initial，或不可继承属性无声明，或根元素无父值）
   */
  source: 'declared' | 'inherited' | 'initial';
  /** 声明来源描述（source=declared 时存在）。 */
  declaredBy?: CandidateOrigin;
  ruleIndex?: number;
  declIndex?: number;
  selector?: string | null;
  important?: boolean;
  /** 来源链上的人类可读步骤。 */
  chain: string[];
  /** 参与比较的全部候选（按收集顺序）。 */
  candidates: Candidate[];
  /** 胜出候选（source=declared 时存在）。 */
  winner?: Candidate;
  /** 被淘汰候选及淘汰原因。 */
  losers: LoserRecord[];
  /** 继承自的父元素编号（source=inherited 时存在）。 */
  inheritedFrom?: string;
  initial?: string;
}

export interface ElementStyle {
  elementId: string;
  tag: string;
  properties: Record<PropertyName, PropertyResolution>;
}

export interface ComputeReport {
  algorithmVersion: string;
  elements: Record<string, ElementStyle>;
}
