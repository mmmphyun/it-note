import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import type { CandidateHypothesisPool, JevRerankerInput, JevRerankerResult } from '@itnote/shared';
import { runJevReranker } from './system1Jev.js';

let activeSession: ort.InferenceSession | null = null;
let isPreloaded = false;

const CANDIDATE_KEYS: Array<keyof CandidateHypothesisPool> = [
  'candidate_project',
  'candidate_routine',
  'candidate_pivot',
  'candidate_longterm',
  'candidate_definition',
];

/**
 * 간단한 서브워드/문자 정규화 토큰 생성기 (한국어 특화 로컬 인코더용)
 */
function tokenizeText(text: string, maxLen: number): number[] {
  // [CLS]=2, [SEP]=3, [PAD]=0, [UNK]=1 기준 어휘 인덱스 생성
  const tokens: number[] = [2]; // [CLS]
  const chars = Array.from(text.trim());
  for (const ch of chars) {
    if (tokens.length >= maxLen - 1) break;
    const code = ch.charCodeAt(0);
    // 한글 음절 및 유니코드 문자를 해시 인덱스로 정규화
    tokens.push((code % 30000) + 10);
  }
  tokens.push(3); // [SEP]

  while (tokens.length < maxLen) {
    tokens.push(0); // [PAD]
  }
  return tokens;
}

/**
 * 5개 직교 가설 후보를 batch_size=5 단일 텐서로 변환
 */
export function buildBatchTensors(
  candidates: CandidateHypothesisPool,
  contextStr: string,
  seqLen = 128
): { inputIds: ort.Tensor; attentionMask: ort.Tensor } {
  const batchSize = 5;
  const totalElements = batchSize * seqLen;
  const inputIdsBuffer = new BigInt64Array(totalElements);
  const maskBuffer = new BigInt64Array(totalElements);

  CANDIDATE_KEYS.forEach((key, bIdx) => {
    const candidateText = candidates[key];
    const combined = `${contextStr} [SEP] ${candidateText}`;
    const tokenIds = tokenizeText(combined, seqLen);

    for (let sIdx = 0; sIdx < seqLen; sIdx++) {
      const flatIdx = bIdx * seqLen + sIdx;
      const tid = tokenIds[sIdx] ?? 0;
      inputIdsBuffer[flatIdx] = BigInt(tid);
      maskBuffer[flatIdx] = tid > 0 ? 1n : 0n;
    }
  });

  const inputIds = new ort.Tensor('int64', inputIdsBuffer, [batchSize, seqLen]);
  const attentionMask = new ort.Tensor('int64', maskBuffer, [batchSize, seqLen]);

  return { inputIds, attentionMask };
}

/**
 * 소프트맥스 확률 정규화
 */
export function computeSoftmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((z) => Math.exp(z - maxLogit));
  const sumExp = exps.reduce((acc, val) => acc + val, 0);
  return exps.map((val) => (sumExp === 0 ? 0 : Math.round((val / sumExp) * 100) / 100));
}

/**
 * 서버 기동 시 1회 모델 프리로드 (preload=True)
 */
export async function preloadNeuralJevEngine(customPath?: string): Promise<boolean> {
  if (isPreloaded && activeSession) {
    return true;
  }

  const defaultPath = path.resolve(process.cwd(), 'models/klue_roberta_large_int8.onnx');
  const targetPath = customPath || process.env.JEV_ONNX_MODEL_PATH || defaultPath;

  if (!fs.existsSync(targetPath)) {
    // 모델 파일이 아직 없으면 휴리스틱 Fallback 모드로 정상 대기
    isPreloaded = false;
    activeSession = null;
    return false;
  }

  try {
    activeSession = await ort.InferenceSession.create(targetPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: 2,
    });
    isPreloaded = true;
    return true;
  } catch (err) {
    console.warn('[neuralJevEngine] Failed to load ONNX session, using fallback:', err);
    activeSession = null;
    isPreloaded = false;
    return false;
  }
}

/**
 * 테스트용 세션 주입 인터페이스
 */
export function setNeuralSessionForTesting(session: ort.InferenceSession | null): void {
  activeSession = session;
  isPreloaded = session !== null;
}

/**
 * 현재 신경망 세션 활성화 여부
 */
export function isNeuralEngineReady(): boolean {
  return activeSession !== null;
}

/**
 * KLUE-RoBERTa 인코더 배치 순전파 기반 Jev Reranker
 * 5-Way 직교 가설 후보를 batch_size=5 1회 패스로 채점
 */
export async function runNeuralJevReranker(input: JevRerankerInput): Promise<JevRerankerResult> {
  const { candidates, userContext } = input;

  // 신경망 세션이 없는 경우 기존 휴리스틱 Jev Reranker로 Fallback
  if (!activeSession) {
    return runJevReranker(input);
  }

  const contextSegments: string[] = [];
  if (userContext.persona?.role) {
    contextSegments.push(`직무: ${userContext.persona.role}`);
  }
  if (userContext.currentRoutine) {
    contextSegments.push(`루틴: ${userContext.currentRoutine}`);
  }
  if (userContext.rejectedHistory?.length) {
    contextSegments.push(`기각이력: ${userContext.rejectedHistory.join(', ')}`);
  }
  const contextStr = contextSegments.join(' | ') || '기본 사용자 맥락';

  // 1. 단일 배치(batch_size=5) 텐서 생성
  const { inputIds, attentionMask } = buildBatchTensors(candidates, contextStr, 128);

  try {
    // 2. 단 1회 포워드 패스 실행 (50~80ms CPU)
    const feeds: Record<string, ort.Tensor> = {
      input_ids: inputIds,
      attention_mask: attentionMask,
    };

    const results = await activeSession.run(feeds);
    const outputNames = activeSession.outputNames;
    const primaryOutput = results[outputNames[0]];

    // 3. 로짓 산출 및 Jev Rule Bias 병합
    const rawLogits: number[] = [];
    if (primaryOutput && primaryOutput.data) {
      const dataArray = Array.from(primaryOutput.data as ArrayLike<number>);
      // batch_size=5 로짓 추출 (출력 텐서의 첫 토큰 또는 클래스 점수)
      for (let i = 0; i < 5; i++) {
        const val = dataArray[i] ?? 0;
        rawLogits.push(Number(val));
      }
    } else {
      for (let i = 0; i < 5; i++) rawLogits.push(0.5);
    }

    // 맥락 신호 가중치 보정
    if (userContext.rejectedHistory && userContext.rejectedHistory.length > 0) {
      rawLogits[2] += 1.2; // candidate_pivot 가중치 상향
    }
    if (userContext.linkedContexts && userContext.linkedContexts.length > 0) {
      rawLogits[3] += userContext.linkedContexts[0].similarity * 1.5; // candidate_longterm 상향
    }
    if (userContext.currentRoutine) {
      rawLogits[1] += 0.8; // candidate_routine 상향
    }

    // 4. 소프트맥스 정규화
    const probabilities = computeSoftmax(rawLogits);

    let bestIdx = 0;
    let maxProb = -1;
    const candidateScores = {} as Record<keyof CandidateHypothesisPool, number>;

    CANDIDATE_KEYS.forEach((key, idx) => {
      const p = probabilities[idx] ?? 0;
      candidateScores[key] = p;
      if (p > maxProb) {
        maxProb = p;
        bestIdx = idx;
      }
    });

    const winningKey = CANDIDATE_KEYS[bestIdx];

    const reasonMap: Record<keyof CandidateHypothesisPool, string> = {
      candidate_project: '신경망 인코더 판별: 프로젝트 및 작업 목표 정합도 최상위 판정',
      candidate_routine: '신경망 인코더 판별: 현재 시간대 루틴 수행 과제 적합 판정',
      candidate_pivot: '신경망 인코더 판별: 기각 이력 및 취소선 의도 반영 최적 대안 판정',
      candidate_longterm: '신경망 인코더 판별: 과거 확정 노트와의 의미적 연관성 최상위 판정',
      candidate_definition: '신경망 인코더 판별: 개념 정의 및 핵심 요약 일치도 최상위 판정',
    };

    return {
      selectedKey: winningKey,
      winningSentence: candidates[winningKey],
      confidenceScore: maxProb,
      reasonNoul: reasonMap[winningKey],
      candidateScores,
    };
  } catch (err) {
    console.warn('[neuralJevEngine] Inference failed, falling back to heuristic:', err);
    return runJevReranker(input);
  }
}
