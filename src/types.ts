export type PropertyName = 'color' | 'font-size' | 'text-align' | 'display' | 'opacity';

export const PROPERTIES: PropertyName[] = ['color', 'font-size', 'text-align', 'display', 'opacity'];

export const INHERITED_PROPERTIES: ReadonlySet<PropertyName> = new Set<PropertyName>([
  'color',
  'font-size',
  'text-align',
]);

export const INITIAL_VALUES: Record<PropertyName, string> = {
  color: '#000000',
  'font-size': '16px',
  'text-align': 'left',
  display: 'inline',
  opacity: '1',
};

export const GLOBAL_KEYWORDS = new Set(['inherit', 'initial', 'unset']);

export interface DeclarationInput {
  property: string;
  value: string;
  important?: boolean;
}

export interface ElementInput {
  id: number;
  tag: string;
  parent: number | null;
  idAttr?: string;
  classes?: string[];
  inline?: DeclarationInput[];
}

export interface RuleInput {
  selector: string;
  declarations: DeclarationInput[];
}

export interface ComputeInput {
  elements: ElementInput[];
  rules: RuleInput[];
}

export type LoseReason = 'importance' | 'specificity' | 'order';

export interface CandidateTrace {
  source: 'rule' | 'inline';
  ruleIndex?: number;
  selector?: string;
  declarationIndex: number;
  important: boolean;
  specificity: [number, number, number] | null;
  value: string;
  outcome: 'winner' | 'loser';
  lostReason?: LoseReason;
}

export type FinalSource =
  | { kind: 'rule'; ruleIndex: number; selector: string; important: boolean }
  | { kind: 'inline'; important: boolean }
  | { kind: 'inherited'; fromElement: number }
  | { kind: 'initial' };

export interface PropertyResult {
  property: PropertyName;
  value: string;
  keyword: 'inherit' | 'initial' | 'unset' | null;
  source: FinalSource;
  candidates: CandidateTrace[];
}

export interface ElementResult {
  elementId: number;
  properties: Record<PropertyName, PropertyResult>;
}

export interface ComputeResult {
  algoVersion: string;
  elements: ElementResult[];
}

export const ALGO_VERSION = '1.0.0';
