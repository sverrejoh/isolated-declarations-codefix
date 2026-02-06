import { User, Post } from "./types.ts";
function createUser(id: number, name: string): User {
  return { id, name };
}
export function getUser() { return createUser(1, "Alice"); }
export function getPost() {
  return {
    title: "Hello",
    body: "World",
    author: getUser(),
  };
}
