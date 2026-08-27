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
    nilDid: string, // surveyOwnerDid.didString,
    encryptedForOwner: EncryptedData
    encryptedForRespondent: EncryptedData
    encryptedScoring: string
    queryIds?: string[]
    isScored: boolean,
    createdAt?: number
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
    config: PoolConfig
}

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
