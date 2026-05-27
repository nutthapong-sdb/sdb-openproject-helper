# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## Output Rules

Return code first. Explanation after, only if non-obvious.
No inline prose. Use comments sparingly - only where logic is unclear.
No boilerplate unless explicitly requested.

Code Rules
Simplest working solution. No over-engineering.
No abstractions for single-use operations.
No speculative features or "you might also want..."
Read the file before modifying it. Never edit blind.
No docstrings or type annotations on code not being changed.
No error handling for scenarios that cannot happen.
Three similar lines is better than a premature abstraction.

Review Rules
State the bug. Show the fix. Stop.
No suggestions beyond the scope of the review.
No compliments on the code before or after the review.

Debugging Rules
Never speculate about a bug without reading the relevant code first.
State what you found, where, and the fix. One pass.
If cause is unclear: say so. Do not guess.

Simple Formatting
No em dashes, smart quotes, or decorative Unicode symbols.
Plain hyphens and straight quotes only.
Natural language characters (accented letters, CJK, etc.) are fine when the content requires them.
Code output must be copy-paste safe.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Safe Deletion Policy

**Never delete user files permanently.**

- When removing files/folders created or managed by this app, always move them to the OS Trash/Recycle Bin.
- In code, use `send2trash.send2trash(path)` (wrapped by `App._trash`) instead of `os.remove`, `os.unlink`, or `shutil.rmtree`.
- If Trash is unavailable or the operation fails, stop and report the error; do not fall back to permanent deletion unless explicitly requested by the user.

## Project Notes (Merged From GEMINI.md)

This section records repo-specific implementation notes that were previously tracked in `GEMINI.md`.

### File Tools Buttons

- Added a button for copying upscaled images into `4000x4000` (Path 1).
- Added a `Local to Remote` button to copy `4000x4000` and `Sticker Set` from Path 1 to Path 2.
- Added button descriptions under `Create Folders` and `Unzip Downloads` in the File Tools section for consistency.
- Implemented file operations in `action_copy_upscale` and `action_local_remote` using `shutil.copy2`.

### Workflow Conventions

- Step 8 (`action_copy_upscale`): copy all images under `~/Downloads/images` (including subfolders) into `Local/<Folder Name>/4000x4000` and rename to `<Clean Name> (1..n)`.
- Step 14 (`_run_local_remote`): when copying `4000x4000` and `Sticker Set` from Local to Remote, rename files to `<Clean Name> (1..n)` starting at `(1)` on Remote.
- Step 14 Elements: copy element files to Remote `4000x4000` without renaming.
- Deletion: any cleanup must use `App._trash()` (send to OS Trash), not permanent deletion.

### UI Conventions

- The GUI is intended to open maximized on launch.
- Steps are laid out in grouped boxes: steps 1-4 grouped, steps 5-9 grouped.
- Scroll behavior should be smooth and reasonably granular (mousewheel scroll uses units, not page jumps).

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
