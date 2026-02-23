export const withDefault = (x = 42) => x;
function getDefault(): number {
  return 0;
}
export const withCallDefault = (x = getDefault()) => x;
export const withRest = (...args: number[]) => args;
