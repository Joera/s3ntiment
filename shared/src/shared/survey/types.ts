import { CardData, SurveyResultsTally } from "../index.js"

export interface SurveyQuestion {
  id: string
  question: string
  type: 'radio' | 'checkbox' | 'text' | 'scale'
  options?: string[]
  scaleRange?: { min: number; max: number; minLabel: string; maxLabel: string }
  required?: boolean
}

export interface SurveyAnswer {
  questionId: string
  questionText: string
  questionType: 'radio' | 'checkbox' | 'text' | 'scale' | 'scored-single'
  answer: string | string[] | number
  scaleRange?: { min: number; max: number; minLabel: string; maxLabel: string }
}

export interface Question {
    id: string
    question: string
    type: 'radio' | 'checkbox' | 'scale' | 'text' | 'scored-single'
    options?: string[]
    scaleRange?: {
        min: number
        max: number
        minLabel: string
        maxLabel: string
    }
    required: boolean
}

// New — scoring info per question
export interface GroupScoring {
    correctAnswer: number  // option index
    points: number
}

// QuestionGroup — add optional scoring sibling
export interface QuestionGroup {
    id: string
    title: string
    questions: Question[]
    scoring?: Record<string, GroupScoring>  // questionId → scoring
}

export interface Batch {
    id: string
    name: string
    pool: string
    survey: string
    amount: number
    medium: 'zip-file' | 'cdn'
    createdAt: number
    cards?: CardData[]
    cardCount?: number
}

export interface PoolConfig {
    safe?: string
    chainId?: number
    litNetwork?: string
    pkpId?: string,
    pkpDid?: string,
    groupId?: string,
    
}

export interface EncryptedData {
    ciphertext: string;
    dataToEncryptHash: string;
}

export interface EncryptedConfig {
    surveyId: string
    poolId: string,
    nilDid: string, // builderDid.didString (nilDB record owner is the PKP DID via ACL, not the survey owner)
    encryptedForOwner: EncryptedData
    encryptedForRespondent: EncryptedData
    encryptedScoring: string
    queryIds?: string[]
    isScored: boolean,
    createdAt?: number
    // Respondent-safe pool crypto identity persisted into the uploaded config so a
    // respondent can source the pool's pkpId/pkpDid/safe/groupId via the decrypt
    // helper (previously only the creating organiser held it in its local store).
    poolConfig?: PoolConfig
}

export interface Survey {
    id?: string
    pool?: string
    title?: string
    createdAt?: number
    introduction?: string
    groups?: QuestionGroup[]
    batches?: Batch[]
    queryIds?: string[]
    results?: SurveyResultsTally
    isScored?: boolean
}
export interface Pool {
    id: string, 
    name: string,
    safeAddress: string, 
    batches: string[], 
    owners?: string[],
    readers?: string[],
    createdAt: number,
    // Optional: a pool's crypto identity (pkpId/pkpDid/groupId) is minted at
    // creation and persisted only by the creating organiser (backend POST
    // /api/pools response); a pool imported via on-chain lookup (getPoolInfo)
    // legitimately has no config, so the type must not force it. The safe +
    // network identity are derivable at import time and populate the field for
    // imported pools.
    config?: PoolConfig
}

// Map / entry aliases — single declaration site across the monorepo (frontends
// must re-import these from @s3ntiment/shared, never re-declare them). See
// SPEC-shared and the type-drift consolidation PR.
export type PoolsMap = Record<string, Pool>;
export type SurveysMap = Record<string, Survey>;
export type BatchesMap = Record<string, Batch>;

// SurveyEntry: a Survey enriched with per-respondent answered-question state.
export interface SurveyEntry extends Survey {
  answeredQuestions: number[];
}

export type SurveyMap = Record<string, SurveyEntry>;

// Event detail types
export interface QuestionUpdateDetail {
    groupIndex: number
    questionIndex: number
    field: string
    value: any
}

export interface OptionUpdateDetail {
    groupIndex: number
    questionIndex: number
    optionIndex: number
    value: string
}

export interface AddOptionDetail {
    groupIndex: number
    questionIndex: number
}

export interface RemoveOptionDetail {
    groupIndex: number
    questionIndex: number
    optionIndex: number
}

export interface RemoveQuestionDetail {
    groupIndex: number
    questionIndex: number
}

export interface AddQuestionDetail {
    groupIndex: number
    type: Question['type']
}

export interface GroupUpdateDetail {
    groupIndex: number
    field: string
    value: any
}

export interface ReorderQuestionsDetail {
    groupIndex: number
    fromIndex: number
    toIndex: number
}
