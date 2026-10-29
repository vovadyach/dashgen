/** The values without repeats, in the order they first appear. */
export const distinct = <T>(values: T[]): T[] => [...new Set(values)];
