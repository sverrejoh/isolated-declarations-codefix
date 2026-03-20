interface Wrapped<T> {
  inner: T;
  displayName?: string;
}
function wrap<T>(component: T): Wrapped<T> {
  return { inner: component };
}
function MyComponent(): string {
  return "hi";
}
export default wrap(MyComponent);
