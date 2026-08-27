export const compactAction = (code: string): string => {
  return code
    .replace(/\n/g, ' ')             // newlines to spaces
    .replace(/\s{2,}/g, ' ')         // collapse multiple spaces to one
    .trim();
};