# Readability Transforms

After the core codefix applies type annotations, a pipeline of readability transforms cleans up the output. The TypeScript codefix tends to produce verbose, fully-expanded types — these transforms collapse them back into idiomatic, human-readable forms.

Transforms run in this order (defined in `src/fixer.ts`):

1. [typeof-intersection](#1-typeof-intersection)
2. [tuple-spread-collapse](#2-tuple-spread-collapse)
3. [extract-types](#3-extract-types)
4. [inline-imports](#4-inline-imports)
5. [collapse-unions](#5-collapse-unions)
6. [generic-alias](#6-generic-alias)
7. [strip-inner-return-types](#7-strip-inner-return-types)

---

## 1. typeof-intersection

**File:** `src/transforms/typeof-intersection.ts`
**Scope:** changed files only
**Always enabled**

When an object literal spreads another exported variable, the codefix inlines all the spread's properties into the type annotation. This transform replaces those inlined properties with `typeof X` intersections.

### Before

```typescript
export const defaults = { a: 1, b: 2, c: 3 };

export const config: {
  a: number;
  b: number;
  c: number;
  debug: boolean;
} = { ...defaults, debug: true };
```

### After

```typescript
export const defaults = { a: 1, b: 2, c: 3 };

export const config: typeof defaults & {
  debug: boolean;
} = { ...defaults, debug: true };
```

Only applies when the spread source is an exported variable in the same file. Properties that are overridden by the object's own properties are kept in the `{ ... }` block.

---

## 2. tuple-spread-collapse

**File:** `src/transforms/tuple-spread-collapse.ts`
**Scope:** changed files only
**Always enabled**

When a `const` array uses spread elements from other exported arrays, the codefix expands the full readonly tuple with every literal element listed out. This transform collapses them back to variadic `...typeof` spreads.

### Before

```typescript
export const ops1 = ["+", "-"] as const;
export const ops2 = ["*", "/"] as const;

export const allOps: readonly [
  "+", "-", "*", "/"
] = [...ops1, ...ops2] as const;
```

### After

```typescript
export const ops1 = ["+", "-"] as const;
export const ops2 = ["*", "/"] as const;

export const allOps: readonly [
  ...typeof ops1, ...typeof ops2
] = [...ops1, ...ops2] as const;
```

Only applies when all spread sources are exported `const` variables in the same file and the element count matches exactly.

---

## 3. extract-types

**File:** `src/transforms/extract-types-transform.ts` (wraps `src/extract-types.ts`)
**Scope:** changed files only
**Always enabled**

Large inline type literals (exceeding a configurable member threshold, default 5) are extracted into named `interface` declarations. When the same type literal appears in multiple files, it is exported from one canonical file and imported elsewhere.

### Before

```typescript
export function getUser(): {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: Date;
} {
  // ...
}
```

### After

```typescript
interface GetUserInterface {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: Date;
}

export function getUser(): GetUserInterface {
  // ...
}
```

If the same type literal appears in `fileA.ts` and `fileB.ts`, the interface is `export`ed from the canonical source (chosen by declaration kind priority) and the other file gets an `import type { ... }` statement.

---

## 4. inline-imports

**File:** `src/transforms/inline-imports.ts`
**Scope:** all project files
**Enabled when:** `--rewrite-inline-imports` flag is set

Replaces `typeof import("./module")` type expressions with namespace imports. These patterns appear when TS can't serialize a type any other way, but they fail isolated declarations checking in some contexts.

### Before

```typescript
export const handler: typeof import("./handlers").default = {
  // ...
};

export const config: typeof import("./config") = {
  // ...
};
```

### After

```typescript
import type * as HandlersModule from "./handlers";
import type * as ConfigModule from "./config";

export const handler: typeof HandlersModule.default = {
  // ...
};

export const config: typeof ConfigModule = {
  // ...
};
```

Skips `typeof import()` nodes inside `TypeLiteral` positions where TS treats them differently. Reuses existing namespace imports when present. Auto-deduplicates alias names against all identifiers in the file.

---

## 5. collapse-unions

**File:** `src/transforms/collapse-unions.ts`
**Scope:** all project files
**Always enabled**

When the codefix expands a type into a string literal union that exactly matches the keys of an in-scope `const` object or `enum`, this transform collapses it back to `keyof typeof X`.

### Before

```typescript
const Direction = {
  Up: 0,
  Down: 1,
  Left: 2,
  Right: 3,
} as const;

export function move(
  dir: "Up" | "Down" | "Left" | "Right"
): void {
  // ...
}
```

### After

```typescript
const Direction = {
  Up: 0,
  Down: 1,
  Left: 2,
  Right: 3,
} as const;

export function move(
  dir: keyof typeof Direction
): void {
  // ...
}
```

Only applies when the union has 3+ string literal members and they exactly match all keys of the candidate object/enum. Works with `as const` objects (including `satisfies` patterns) and enum declarations.

---

## 6. generic-alias

**File:** `src/transforms/generic-alias.ts`
**Scope:** changed files only
**Always enabled**

When a variable is initialized from a generic function call like `createStore<State>()`, the codefix often expands the return type into its full structural form. This transform has two passes:

**Pass 1 — Alias symbol replacement:** If the inferred type has an `aliasSymbol` (i.e., the return type is a named type alias), replace the expanded annotation with `AliasName<TypeArgs>`. Adds missing imports automatically.

**Pass 2 — Re-serialization:** For remaining long annotations (80+ chars), re-serializes the type via `typeToTypeNode()` which may produce a shorter form using aliases defined outside the current scope. Rolls back if re-serialization introduces errors.

### Before

```typescript
export const store: {
  getState: () => State;
  setState: (s: State) => void;
  subscribe: (fn: () => void) => () => void;
} = createStore<State>();
```

### After

```typescript
export const store: Store<State> =
  createStore<State>();
```

Only replaces when the simplified form is shorter than the expanded annotation. Runs `organizeImports` afterwards to clean up.

---

## 7. strip-inner-return-types

**File:** `src/transforms/strip-inner-return-types.ts`
**Scope:** changed files only
**Always enabled**

The codefix adds return type annotations to all functions, including inner callbacks nested inside already-typed exported functions. These inner annotations are redundant — TypeScript can infer them from the parent's return type. This transform strips them.

### Before (after codefix)

```typescript
export const createApi = (): {
  getUser: (id: string) => Promise<User>;
  listUsers: (filter: Filter) => Promise<User[]>;
  deleteUser: (id: string) => Promise<boolean>;
} => {
  return {
    getUser: (id: string): Promise<User> => {
      return db.findUser(id);
    },
    listUsers: (filter: Filter): Promise<User[]> => {
      return db.query(filter);
    },
    deleteUser: (id: string): Promise<boolean> => {
      return db.remove(id);
    },
  };
};
```

### After

```typescript
export const createApi = (): {
  getUser: (id: string) => Promise<User>;
  listUsers: (filter: Filter) => Promise<User[]>;
  deleteUser: (id: string) => Promise<boolean>;
} => {
  return {
    getUser: (id: string) => {
      return db.findUser(id);
    },
    listUsers: (filter: Filter) => {
      return db.query(filter);
    },
    deleteUser: (id: string) => {
      return db.remove(id);
    },
  };
};
```

The outer return type already declares what each callback returns, so the `: Promise<User>`, `: Promise<User[]>`, and `: Promise<boolean>` annotations on the inner functions are redundant. Only strips annotations that were **added by the codefix** (not present in the original file). Skips directly exported functions, generic functions, and functions not nested inside a typed export. Validates that removing the annotation doesn't introduce new errors — rolls back if it does.
