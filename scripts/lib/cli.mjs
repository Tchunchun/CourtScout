export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function requireArg(args, name, usage) {
  if (!args[name]) {
    throw new Error(`Missing --${name}\n\n${usage}`);
  }
  return args[name];
}

export function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .replace(/[\s_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
