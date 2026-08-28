// shared/src/survey/query.ts
import { randomUUID } from 'crypto';
import { Survey, QuestionGroup } from './types.js';

export function createSurveyAggregationQuery(surveyId: string, groups: QuestionGroup[]) {
    const groupStage: Record<string, any> = { _id: null };

    for (const group of groups) {
        for (const question of group.questions) {
            switch (question.type) {
                case 'scale':
                    groupStage[`${question.id}_sum`] = { $sum: `$${question.id}` };
                    break;
                case 'radio':
                case 'checkbox':
                    if (question.options) {
                        for (let i = 0; i < question.options.length; i++) {
                            groupStage[`${question.id}_${i}_sum`] = { $sum: `$${question.id}_${i}` };
                        }
                    }
                    break;
                // text fields — skip, no aggregation
            }
        }
    }

    groupStage['total_responses'] = { $sum: 1 };

    return {
        _id: randomUUID(),
        name: `survey-${surveyId}-aggregation`,
        collection: surveyId,
        variables: {},
        pipeline: [{ $group: groupStage }]
    };
}