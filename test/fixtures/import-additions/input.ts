import { declareString, declareStringWithPlaceholders } from "./types";

export const Greeting = declareString("app.greeting", {
  text: "Hello",
  comment: "A greeting",
});

export const Farewell = declareString("app.farewell", {
  text: "Goodbye",
  comment: "A farewell",
});

export const Welcome = declareStringWithPlaceholders("app.welcome", {
  text: ({ name }) => `Welcome ${name}`,
  comment: "A welcome message",
});

export const Alert = declareString("app.alert", {
  text: "Warning",
  comment: "An alert",
});
