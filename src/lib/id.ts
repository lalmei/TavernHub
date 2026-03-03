export function randomId(prefix = ''): string {
  const chunk = Math.random().toString(36).slice(2, 10);
  return `${prefix}${chunk}`;
}
