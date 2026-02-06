import { getUser, getPost } from "./utils.js";
export const user = getUser();
export const post = getPost();
export function processUser(u = getUser()) { return u.name; }
