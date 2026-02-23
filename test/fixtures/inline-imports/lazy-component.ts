// Pattern from 1JS: lazy-loaded component
export const loadComponent = () => import("./component.ts");

// Mapped type from a function in another module
import { createConfig } from "./internal.ts";

export const configs = {
  dev: createConfig("localhost", 3000),
  prod: createConfig("prod.example.com", 443),
};
