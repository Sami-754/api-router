/** Rough token estimate (~4 chars/token). */
export function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

/**
 * Estimated request cost in tokens: the prompt estimate plus the
 * requested output budget (defaults to a conservative 1024).
 */
export function estimateRequestTokens(
  messages: Array<{ content: string | unknown[] }>,
  maxTokens?: number | null,
): number {
  const chars = messages.reduce(
    (n, m) =>
      n +
      (typeof m.content === "string"
        ? m.content.length
        : JSON.stringify(m.content).length),
    0,
  );
  return estimateTokensFromChars(chars) + (maxTokens ?? 1024);
}
