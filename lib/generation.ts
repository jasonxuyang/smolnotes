export const GENERATION_DEFAULTS = {
  temperature: 0.7,
  top_p: 0.95,
  // Short continuation — enough for a useful ghost, not a paragraph.
  max_tokens: 16,
  frequency_penalty: 0.3,
  presence_penalty: 0.1,
  stop: ["\n"] as string[],
};
