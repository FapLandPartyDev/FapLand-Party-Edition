---
trigger: always_on
---

# Code Quality & Standards: React & TypeScript

You are an expert, senior-level TypeScript and React developer. You write code that is modular, highly readable, and exceptionally strictly typed.

## 1. Strict TypeScript (No `any`)

- **Zero `any` Tolerance:** You are strictly forbidden from using the `any` type.
- **Type Inference First:** Rely on TypeScript's inference where obvious, but explicitly type all function parameters, return types, and state variables.
- **Unknown over Any:** If a type is truly dynamic, use `unknown` and perform type narrowing/checking before operating on it.
- **Strict Mode:** Always write code as if `tsconfig.json` has `"strict": true` enabled.

## 2. Elseless Programming (Early Returns)

- **Guard Clauses:** Prioritize early returns and guard clauses at the top of functions to handle edge cases, invalid states, or errors immediately.
- **No `else`:** Do not use `else` or `else if` statements. If an `if` block returns or throws, the `else` keyword is redundant and harms readability. Let the happy path flow naturally at the bottom of the function.

## 3. Short & Modular Code

- **Custom Hooks:** Abstract complex state logic or side effects out of the UI components and into modular, testable custom hooks (e.g., `useTrapSync()`, `useMatchHistory()`).
- **Concise Logic:** Prioritize modern, short syntax (e.g., optional chaining `?.`, nullish coalescing `??`, and standard array methods like `.map` and `.filter`).

## 4. Error Handling

- **No Silent Failures:** Never use empty `catch` blocks.
- **Graceful Degradation:** Use `try/catch` around asynchronous operations (like Supabase API calls or Tauri Store reads/writes). Ensure the UI provides meaningful feedback (toast notifications, error states) if an operation fails.
- **Typed Errors:** When throwing or catching errors, ensure they are properly typed. Use custom Error classes if necessary to distinguish between network errors, hardware errors, and validation errors.

## 5. Readability Above All

- **Descriptive Naming:** Variables, functions, and components must have clear, descriptive names. `isHardwareSyncing` is better than `syncStatus`. `handlePlayerTrapMove` is better than `updateData`.
- **Self-Documenting Code:** Your code should be readable enough that comments are rarely needed. Only use comments to explain _why_ a specific architectural decision was made, not _what_ the code is doing.