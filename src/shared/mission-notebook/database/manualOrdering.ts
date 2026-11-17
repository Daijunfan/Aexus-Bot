/** Persist manual positions on a view without dropping IDs currently hidden by filters. */
export function moveManualRecord(
  previous: string[] | undefined,
  visible: string[],
  moving: string,
  target?: string,
  after = false,
): string[] {
  if (!visible.includes(moving) || moving === target) return previous || [];
  const order = [...new Set([...(previous || []), ...visible])].filter(id => id !== moving);
  const position = target ? order.indexOf(target) : -1;
  order.splice(position < 0 ? order.length : position + Number(after), 0, moving);
  return order;
}
