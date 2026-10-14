import { twMerge } from 'tailwind-merge';

/**
 * Joins class names and resolves Tailwind conflicts, so a class passed in later (an override such as
 * `<Panel className="bg-card">` or `<Button className="h-11">`) always wins over the component's
 * own default, whatever order the stylesheet happens to emit them in.
 */
export const cn = (...classes: (string | false | null | undefined)[]) => twMerge(classes);
