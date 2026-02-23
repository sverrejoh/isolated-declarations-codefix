const ErrorCodes = {
  NotFound: 404,
  Unauthorized: 401,
  Forbidden: 403,
  BadRequest: 400,
} as const;

function enumMembership<T extends Record<string, unknown>>(
  obj: T
): (key: unknown) => key is keyof T {
  return (key: unknown): key is keyof T =>
    typeof key === "string" && key in obj;
}

// Pure union case: TS will add expanded type annotation
// for the inferred (key: unknown) => key is keyof T.
export const isValidErrorCode = enumMembership(ErrorCodes);

// Mixed union case: keyof typeof X | undefined
export function getCodeOrUndefined(input: string) {
  if (input in ErrorCodes) {
    return input as keyof typeof ErrorCodes;
  }
  return undefined;
}

export enum Direction {
  Up = "UP",
  Down = "DOWN",
  Left = "LEFT",
  Right = "RIGHT",
}

// Enum pure union case
export const isValidDirection = enumMembership(Direction);

// Enum mixed union case
export function getDirectionOrUndefined(input: string) {
  if (input in Direction) {
    return input as keyof typeof Direction;
  }
  return undefined;
}
