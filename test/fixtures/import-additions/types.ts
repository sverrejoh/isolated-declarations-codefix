export type StringFunction = () => string;
export type StringFunctionWithPlaceholders<T extends string> = (
  placeholders: Record<T, string>
) => string;

export function declareString(
  _id: string,
  _opts: { text: string; comment: string }
): StringFunction {
  return () => _opts.text;
}

export function declareStringWithPlaceholders<T extends string>(
  _id: string,
  _opts: {
    text: (p: Record<T, string>) => string;
    comment: string;
  }
): StringFunctionWithPlaceholders<T> {
  return (p) => _opts.text(p);
}
