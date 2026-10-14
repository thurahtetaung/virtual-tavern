import { extendTailwindMerge } from 'tailwind-merge';

// In Tailwind v4 a font size only sets the line height as a fallback (`var(--tw-leading, …)`), so a
// `leading-*` class wins whatever comes after it. tailwind-merge still drops a `leading-*` that is
// followed by a font size, which would undo it.
const merge = extendTailwindMerge({ override: { conflictingClassGroups: { 'font-size': [] } } });

/**
 * Joins class names and resolves Tailwind conflicts, so a class passed in later (an override such as
 * `<Panel className="bg-card">` or `<Button className="h-11">`) always wins over the component's
 * own default, whatever order the stylesheet happens to emit them in.
 */
export const cn = (...classes: (string | false | null | undefined)[]) => merge(classes);
