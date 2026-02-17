import { createPresenceComponent } from "fake-motion";

export type DrawerMotionParams = {
  position: "start" | "end" | "bottom";
  size: "small" | "medium" | "large" | "full";
  dir: "ltr" | "rtl";
};

// This should be annotated as PresenceComponent<DrawerMotionParams>,
// NOT as the expanded structural type.
export const InlineDrawerMotion = createPresenceComponent<DrawerMotionParams>(
  ({ position, size, dir }) => {
    return {
      enter: {
        keyframes: [{ opacity: 0 }, { opacity: 1 }],
        duration: 300,
        easing: "ease-in",
      },
      exit: {
        keyframes: [{ opacity: 1 }, { opacity: 0 }],
        duration: 200,
        easing: "ease-out",
      },
    };
  },
);

// Same pattern, second export
export const OverlayDrawerMotion = createPresenceComponent<DrawerMotionParams>(
  ({ position, size, dir }) => {
    return {
      enter: {
        keyframes: [{ transform: "translateX(-100%)" }, { transform: "translateX(0)" }],
        duration: 400,
        easing: "ease-in",
      },
      exit: {
        keyframes: [{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }],
        duration: 300,
        easing: "ease-out",
      },
    };
  },
);
