import { Question, Survey } from "../index.js";

export const prepareAnswers = (answers: any, surveyConfig: Survey) => {
    const questionMap = new Map<string, Question>();
    
    if (surveyConfig.groups) {
        surveyConfig.groups.forEach(group => {
            group.questions.forEach(q => {
                questionMap.set(q.id, q);
            });
        });
    }

    return answers.map((answer: any) => {
        const question = questionMap.get(answer.questionId);
        
        if (answer.questionType === 'radio') {
            // Find the index of the selected option
            const optionIndex = question?.options?.findIndex(opt => opt === answer.answer) ?? -1;
            return {
                questionId: answer.questionId,
                questionText: answer.questionText,
                questionType: answer.questionType,
                answer: optionIndex >= 0 ? optionIndex : 0
            };
        } else if (answer.questionType === 'scale') {
            const rating = parseInt(String(answer.answer), 10);
            return {
                questionId: answer.questionId,
                questionText: answer.questionText,
                questionType: answer.questionType,
                answer: isNaN(rating) ? 0 : rating
            };
        } else if (answer.questionType === 'checkbox') {
            const selected = Array.isArray(answer.answer)
                ? answer.answer.map((val: any) => question?.options?.indexOf(val) ?? -1).filter((i: number) => i >= 0)
                : [];
            return {
                questionId: answer.questionId,
                questionText: answer.questionText,
                questionType: answer.questionType,
                answer: selected
            };
        } else {
            return {
                questionId: answer.questionId,
                questionText: answer.questionText,
                questionType: answer.questionType,
                answer: String(answer.answer)
            };
        }
    });
}
    
const ensureAllot = (content: string | number | { "%allot": string | number }): { "%allot": number } => {
    if (content && typeof content === "object" && "%allot" in content) {
        return { "%allot": Number(content["%allot"]) };
    }
    return { "%allot": Number(content ?? 0) };
}

const findQuestion = (survey: Survey, questionId: string): Question | undefined => {
    for (const group of survey.groups ?? []) {
        for (const question of group.questions) {
            if (question.id === questionId) return question;
        }
    }
    return undefined;
}

export const createUserDataObject = (uuid: string, answers: any, survey: Survey, signerAddress: string) => {

    const preparedAnswers = prepareAnswers(answers, survey);
    const dataObject: Record<string, any> = { _id: uuid, surveyId: survey.id, signer: signerAddress };
    
    preparedAnswers.forEach((answer: any) => {
        if (answer.questionType === 'checkbox' || answer.questionType === 'radio') {

            const selectedIndices = Array.isArray(answer.answer) 
                ? answer.answer 
                : [Number(answer.answer)];
            
            const question = findQuestion(survey, answer.questionId);
            const optionCount = question?.options?.length ?? (Math.max(...selectedIndices) + 1);

            for (let i = 0; i < optionCount; i++) {
                const fieldName = `${answer.questionId}_${i}`;
                dataObject[fieldName] = ensureAllot(selectedIndices.includes(i) ? 1 : 0);
            }
        } else if (answer.questionType === 'text') {
        // Text is plaintext, no wrapping
            dataObject[answer.questionId] = String(answer.answer);
        } else {
            dataObject[answer.questionId] = ensureAllot(answer.answer);
        }
    });
    
    return dataObject;
}