export interface User {
  id: number;
  name: string;
}
export interface Post {
  title: string;
  body: string;
  author: User;
}
