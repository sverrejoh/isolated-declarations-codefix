export const arithmetic = ["+", "-", "*", "/"] as const;
export const comparison = ["==", "!=", "<", ">"] as const;
export const membership = ["in"] as const;

// All spreads — should collapse entirely
export const operators = [
  ...arithmetic,
  ...comparison,
  ...membership,
] as const;

// Mixed spread + literal — keep literal inline
export const withOwn = [...arithmetic, "extra", ...comparison] as const;

// Chained: spread source is itself a spread-based array
export const all = [...operators, "?", "."] as const;

// No spread — should not be touched
export const plain = [1, 2, 3] as const;
