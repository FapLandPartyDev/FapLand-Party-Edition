export function extractOpenedFileArguments(
  argv: readonly string[],
  options: { packaged?: boolean } = {}
): string[] {
  const candidates = argv.slice(options.packaged === false ? 2 : 1).filter((argument) => {
    const value = argument.trim();
    return value.length > 0 && !value.startsWith("--") && !/^fland:/i.test(value);
  });
  return [...new Set(candidates)];
}
