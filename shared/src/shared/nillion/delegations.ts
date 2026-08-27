// export async function fetchNillionDelegation(
//   backendUrl: string,
//   didString: string,
//   surveyId: string,
//   signature: string,
//   signal?: AbortSignal
// ): Promise<string> {

//   const response: any = await fetch(`${backendUrl}/api/surveys/${surveyId}/delegation`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ didString, surveyId, signature }),
//     signal,
//   });

//   if (!response.ok) {
//     const { msg } = await response.json();
//     throw new Error(msg ?? 'fetchNillionDelegation: unauthorized');
//   }

//   const { delegation } = await response.json();
//   return delegation;
// }