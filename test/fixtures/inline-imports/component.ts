export interface ComponentProps {
  title: string;
  onClick?: () => void;
}

export function Component(props: ComponentProps): string {
  return props.title;
}

export default Component;
