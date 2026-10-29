/**
 * Jev TypeSafe AI 의사결정 프리미티브 및 응답 규격
 */

export interface Noul {
  type: 'noul';
  probability: number;
  value: boolean;
}

export interface Choice<T extends string = string> {
  type: 'choice';
  selected: T;
  confidence: number;
}

export interface Score {
  type: 'score';
  value: number;
}

export interface Box {
  type: 'box';
  coordinates: [number, number, number, number]; // [minX, minY, maxX, maxY]
}

export type StrikethroughIntent = 'THOUGHT_PIVOT' | 'TYPO_CORRECTION' | 'NONE';
export type VisualStructure = 'CONTRAST_ARROW' | 'MIND_MAP' | 'LIST' | 'ISOLATED';
export type DomainRoute = 'SIDE_PROJECT_SPARK' | 'DEVSECOPS_STUDY' | 'ROUTINE_TASK' | 'GENERAL_IDEA';
export type InputClassification = 'FEEDBACK_REPLY' | 'NEW_INDEPENDENT_MEMO' | 'STRIKE_THROUGH';
export type FeedbackIntent = 'CONFIRM_ACCEPT' | 'REJECT_CANCEL' | 'CORRECTION_MODIFY' | 'NONE';
export type ActionTask =
  | 'SELECTION_PIVOT'
  | 'ALTERNATIVE_COMPARE'
  | 'PARAM_ADJUST'
  | 'ITEM_ACCUMULATE'
  | 'PIPELINE_FLOW'
  | 'CAUSE_DIAGNOSE'
  | 'RECORD_CONFIRM';

export interface JevDecision {
  isContinuousWithPrevious: Noul;
  inputClassification?: Choice<InputClassification>;
  feedbackIntent?: Choice<FeedbackIntent>;
  strikethroughIntent: Choice<StrikethroughIntent>;
  visualStructure: Choice<VisualStructure>;
  domainRoute: Choice<DomainRoute>;
  actionTask?: Choice<ActionTask>;
  marginBox: Box;
}

export interface ExtractedKeywords {
  active: string[];
  struckOut: string[];
  chosen?: string[];
  emphasized?: string[];
}

export interface JevDecisionResult {
  jevDecision: JevDecision;
  extractedKeywords: ExtractedKeywords;
  sentence: string;
}

export interface StrokeMetadata {
  strokeCount: number;
  bbox: [number, number, number, number];
  canvasSize: [number, number];
}

export interface InferUserContext {
  persona?: { role?: string; interests?: string[] };
  currentRoutineState?: string;
  evolvingTopics?: string[];
  recentConfirmedNotes?: string[];
}

export interface InferRequestBody {
  croppedImageBase64?: string;
  rawTextInput?: string;
  strokeMetadata?: StrokeMetadata;
  previousEvaporatedContext?: string | null;
  activeHypothesisSentence?: string | null;
  rejectedHypotheses?: string[];
  userContext?: InferUserContext;
}

export type InferResponseBody = JevDecisionResult;
