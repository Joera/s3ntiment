// shared/src/survey/tally.ts
export function combineShares(nodeResults: any[]): Record<string, number> {
    const combined: Record<string, number> = {};

    for (const result of nodeResults) {
        if (!Array.isArray(result)) continue;
        for (const row of result) {
            for (const [key, value] of Object.entries(row)) {
                if (key === '_id') continue;
                if (typeof value === 'number') {
                    combined[key] = (combined[key] || 0) + value;
                }
            }
        }
    }

    return combined;
}