import { CreateCollectionRequest } from '@nillion/secretvaults';
import { Question, Survey } from '../index.js';
import { randomUUID } from 'crypto';


export const createSurveyCollectionSchema = (config: Survey, type: "owned" | "standard" = "standard") => {
    const properties: Record<string, any> = {
        _id: { type: "string", format: "uuid" },
        surveyId: { type: "string" },
        signer: { type: "string" }
    };

    if (config.groups) {
        for (const group of config.groups) {
            for (const question of group.questions) {
                addQuestionProperties(properties, question);
            }
        }
    }

    return {
        _id: config.id,
        name: config.id || config.title || 'untitled',
        type,
        schema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "array",
            uniqueItems: true,
            items: {
                type: "object",
                properties,
                required: ["_id",'surveyId']
            }
        }
    };
}


function addQuestionProperties(properties: Record<string, any>, question: Question) {
    switch (question.type) {
        case "radio":
        case "scale":
            // Single integer - SUM works
            properties[question.id] = {
                type: "object",
                // properties: { "%share": { type: "integer" } }
                properties: { "%share": { type: "string" } }
            };
            break;

        case "checkbox":
            // Each option separate - SUM per option
            if (question.options) {
                for (let i = 0; i < question.options.length; i++) {
                    properties[`${question.id}_${i}`] = {
                        type: "object",
                       // properties: { "%share": { type: "integer" } }  // 0 or 1
                        properties: { "%share": { type: "string" } } 
                    };
                }
            }
            break;

        case "text":
            // No blind compute, only ACL
            properties[question.id] = { type: "string" };
            break;
    }
}
