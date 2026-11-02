/**
 * The wait before the second try a failed call to Gemini or the database
 * gets: 0.5 to 1.5 seconds, random, so retries from many runs don't all land
 * at once (docs/design.md, when things go wrong).
 */
export const retryDelay = () => 500 + Math.random() * 1_000;
