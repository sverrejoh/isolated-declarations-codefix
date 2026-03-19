export interface ComponentProps {
  name: string;
  value: number;
}

export function Component(
  _props: ComponentProps
): void {}

export function withContext<P>(
  component: (props: P) => void
): (props: P) => void {
  return component;
}
