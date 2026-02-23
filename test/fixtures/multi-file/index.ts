import { getPost, getUser } from "./utils.ts";
export const user = getUser();
export const post = getPost();
export function processUser(u = getUser()) {
  return u.name;
}
