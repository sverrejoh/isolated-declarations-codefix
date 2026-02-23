import {
  withCardFrameContext,
  CardFrameContext,
} from "@card-framework/core";
import {
  Component,
  ComponentProps,
} from "./component.ts";

// Verbose expanded annotation (simulates what the fixer
// produces in real-world card-framework when alias info
// is lost during generic resolution).
export const WrappedA: (props: {
  name: string;
  value: number;
  label: string;
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
}) => void = withCardFrameContext(Component);

// Missing annotation — triggers TS9007 so the fixer
// adds the file to filesChanged.
export const WrappedB =
  withCardFrameContext(Component);
