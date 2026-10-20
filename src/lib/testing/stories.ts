/** Helpers for tests that check the component catalogue's stories. Only tests import this. */

const argsOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && "args" in value && typeof value.args === "object" && value.args
    ? (value.args as Record<string, unknown>)
    : {};

/**
 * Each story's args, by export name, from a stories module (CSF): the metadata's args
 * with the story's own on top, as Storybook combines them.
 */
export function storyArgs(module: Record<string, unknown>): [name: string, args: Record<string, unknown>][] {
  const defaults = argsOf(module["default"]);
  return Object.entries(module).flatMap(([name, story]) =>
    name === "default" || typeof story !== "object" || story === null
      ? []
      : [[name, { ...defaults, ...argsOf(story) }] as [string, Record<string, unknown>]],
  );
}
