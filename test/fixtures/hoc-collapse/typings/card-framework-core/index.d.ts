export type CardFrameContext = {
  theme: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    foreground: string;
    border: string;
  };
  layout: {
    columns: number;
    gap: number;
    padding: number;
    maxWidth: number;
  };
  state: {
    isExpanded: boolean;
    isSelected: boolean;
    isDisabled: boolean;
    isFocused: boolean;
  };
};

export declare function withCardFrameContext<P>(
  component: (props: P) => void,
): (props: P & CardFrameContext) => void;
