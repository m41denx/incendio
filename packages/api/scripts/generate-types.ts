/**
 * Generates src/api/types/generated.ts from the Go API structs in lxc/incus
 * (`shared/api/*.go`).
 *
 * The Go source is used instead of doc/rest-api.yaml because the swagger file
 * flattens embedded structs and carries no optionality: the `omitempty` json
 * tag is the only reliable signal for which fields may be absent.
 *
 * Usage: INCUS_SRC=~/refs/incus bun run generate-types
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const INCUS_SRC = process.env.INCUS_SRC ?? join(homedir(), "refs", "incus");
const API_DIR = join(INCUS_SRC, "shared", "api");
const OUT = join(import.meta.dir, "..", "src", "api", "types", "generated.ts");

// Untyped Go string consts grouped by name prefix -> TS union name.
const CONST_GROUPS: Record<string, string> = {
  EventLifecycle: "LifecycleAction",
  EventType: "EventType",
  OperationClass: "OperationClass",
};

interface Field {
  name: string;
  type: string;
  optional: boolean;
  doc: string[];
}

interface StructDecl {
  kind: "struct";
  name: string;
  doc: string[];
  extends: string[];
  fields: Field[];
}

interface AliasDecl {
  kind: "alias";
  name: string;
  doc: string[];
  goType: string;
}

type Decl = StructDecl | AliasDecl;

const decls = new Map<string, Decl>();
const typedConsts = new Map<string, (string | number)[]>();
const groupedConsts = new Map<string, string[]>();

const cleanDoc = (lines: string[]): string[] => {
  const out = lines
    .map((l) => l.replace(/^\/\/ ?/, ""))
    .filter((l) => !l.startsWith("swagger:"));
  while (out.length && out[0]!.trim() === "") out.shift();
  while (out.length && out[out.length - 1]!.trim() === "") out.pop();
  return out.map((l) => l.replace(/\*\//g, "*\\/"));
};

const parseTag = (tag: string | undefined, goName: string) => {
  const json = tag?.match(/json:"([^"]*)"/)?.[1];
  if (json === undefined)
    return { name: goName, omitempty: false, skip: false };
  const [name, ...opts] = json.split(",");
  return {
    name: name || goName,
    omitempty: opts.includes("omitempty"),
    skip: name === "-",
  };
};

const parseFile = (source: string) => {
  const lines = source.split("\n");
  let doc: string[] = [];
  let constBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith("//")) {
      doc.push(line);
      continue;
    }

    if (constBlock) {
      if (line.startsWith(")")) {
        constBlock = false;
      } else {
        collectConst(line.trim());
      }
      continue;
    }
    if (line.startsWith("const (")) {
      constBlock = true;
      doc = [];
      continue;
    }
    if (line.startsWith("const ")) {
      collectConst(line.slice("const ".length).trim());
      doc = [];
      continue;
    }

    const struct = line.match(/^type (\w+) struct \{$/);
    if (struct) {
      const decl: StructDecl = {
        kind: "struct",
        name: struct[1]!,
        doc: cleanDoc(doc),
        extends: [],
        fields: [],
      };
      let fieldDoc: string[] = [];
      for (i++; i < lines.length && lines[i] !== "}"; i++) {
        const raw = lines[i]!.trim();
        if (raw.startsWith("//")) {
          fieldDoc.push(raw);
          continue;
        }
        if (raw === "") {
          fieldDoc = [];
          continue;
        }
        const embedded = raw.match(/^\*?([\w.]+)\s*(`[^`]*`)?$/);
        if (embedded) {
          // Embedded types from other Go packages (e.g. url.URL) are not API types.
          if (embedded[1]!.includes(".")) {
            fieldDoc = [];
            continue;
          }
          const tag = parseTag(embedded[2], embedded[1]!);
          if (!embedded[2]?.includes('json:"') || tag.name === embedded[1]) {
            decl.extends.push(embedded[1]!);
          } else {
            decl.fields.push({
              name: tag.name,
              type: embedded[1]!,
              optional: tag.omitempty,
              doc: cleanDoc(fieldDoc),
            });
          }
          fieldDoc = [];
          continue;
        }
        const field = raw.match(/^(\w+)\s+(\S+)\s*(`[^`]*`)?\s*(\/\/.*)?$/);
        if (!field) {
          throw new Error(`Unparsed field in ${decl.name}: ${raw}`);
        }
        const [, goName, goType, tagText, trailing] = field;
        if (!/^[A-Z]/.test(goName!)) {
          fieldDoc = [];
          continue;
        }
        const tag = parseTag(tagText, goName!);
        if (!tag.skip) {
          decl.fields.push({
            name: tag.name,
            type: goType!,
            optional: tag.omitempty,
            doc: cleanDoc(trailing ? [...fieldDoc, trailing] : fieldDoc),
          });
        }
        fieldDoc = [];
      }
      decls.set(decl.name, decl);
      doc = [];
      continue;
    }

    const alias = line.match(/^type (\w+) (\S.*)$/);
    if (alias && !alias[2]!.startsWith("interface")) {
      decls.set(alias[1]!, {
        kind: "alias",
        name: alias[1]!,
        doc: cleanDoc(doc),
        goType: alias[2]!.replace(/^= /, ""),
      });
    }
    doc = [];
  }
};

const collectConst = (line: string) => {
  // Name Type = value | Name = Type(value) | Name = value
  const typed =
    line.match(/^(\w+)\s+(\w+)\s*=\s*("[^"]*"|-?\d+)/) ??
    line.match(/^(\w+)\s*=\s*(\w+)\(("[^"]*"|-?\d+)\)/)?.slice(0, 4);
  if (typed) {
    const [, , type, value] = typed as string[];
    const list = typedConsts.get(type!) ?? [];
    list.push(value!.startsWith('"') ? JSON.parse(value!) : Number(value));
    typedConsts.set(type!, list);
    return;
  }
  const untyped = line.match(/^(\w+)\s*=\s*("[^"]*")/);
  if (untyped) {
    for (const [prefix, union] of Object.entries(CONST_GROUPS)) {
      if (untyped[1]!.startsWith(prefix)) {
        const list = groupedConsts.get(union) ?? [];
        list.push(JSON.parse(untyped[2]!));
        groupedConsts.set(union, list);
      }
    }
  }
};

const tsType = (goType: string): string => {
  if (goType.startsWith("*")) return `${tsType(goType.slice(1))} | null`;
  if (goType.startsWith("[]")) {
    const inner = goType.slice(2);
    if (inner === "byte") return "string";
    const t = tsType(inner);
    return t.includes(" ") ? `(${t})[]` : `${t}[]`;
  }
  const map = goType.match(/^map\[(\w+)\](.+)$/);
  if (map) {
    const key = decls.has(map[1]!) ? map[1]! : "string";
    return `Record<${key}, ${tsType(map[2]!)}>`;
  }
  switch (goType) {
    case "string":
      return "string";
    case "bool":
      return "boolean";
    case "int":
    case "int8":
    case "int16":
    case "int32":
    case "int64":
    case "uint":
    case "uint8":
    case "uint16":
    case "uint32":
    case "uint64":
    case "float32":
    case "float64":
    case "byte":
      return "number";
    case "time.Time":
      return "string";
    case "time.Duration":
      return "number";
    case "any":
    case "interface{}":
    case "json.RawMessage":
      return "unknown";
  }
  if (decls.has(goType)) return goType;
  return "unknown";
};

const renderDoc = (doc: string[], indent = ""): string => {
  if (doc.length === 0) return "";
  const body = doc.map((l) => {
    const example = l.match(/^Example: (.*)$/);
    return `${indent} * ${example ? `@example ${example[1]}` : l}`.trimEnd();
  });
  return `${indent}/**\n${body.join("\n")}\n${indent} */\n`;
};

const propName = (name: string) =>
  /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);

const render = (): string => {
  const out: string[] = [];
  const names = [...decls.keys()].sort();

  for (const name of names) {
    const decl = decls.get(name)!;
    if (decl.kind === "alias") {
      const values = typedConsts.get(name);
      let t = tsType(decl.goType);
      if (values?.length && (t === "string" || t === "number")) {
        const literals = [...new Set(values)].map((v) => JSON.stringify(v));
        // Keep the union open: the daemon may return values newer than the
        // source this file was generated from.
        t = `${literals.join(" | ")} | (${t} & {})`;
      }
      out.push(`${renderDoc(decl.doc)}export type ${name} = ${t};\n`);
      continue;
    }
    const ext = decl.extends.filter((e) => decls.has(e));
    const head = `export interface ${name}${ext.length ? ` extends ${ext.join(", ")}` : ""}`;
    const fields = decl.fields
      .map(
        (f) =>
          `${renderDoc(f.doc, "  ")}  ${propName(f.name)}${f.optional ? "?" : ""}: ${tsType(f.type)};`,
      )
      .join("\n");
    out.push(
      `${renderDoc(decl.doc)}${head} {${fields ? `\n${fields}\n` : ""}}\n`,
    );
  }

  for (const [union, values] of groupedConsts) {
    const literals = [...new Set(values)].sort().map((v) => JSON.stringify(v));
    out.push(
      `export type ${union} =\n  | ${literals.join("\n  | ")}\n  | (string & {});\n`,
    );
  }

  return out.join("\n");
};

const files = readdirSync(API_DIR).filter(
  (f) => f.endsWith(".go") && !f.endsWith("_test.go"),
);
for (const file of files.sort()) {
  parseFile(readFileSync(join(API_DIR, file), "utf8"));
}

const commit = execSync("git rev-parse --short HEAD", { cwd: INCUS_SRC })
  .toString()
  .trim();

writeFileSync(
  OUT,
  `/* eslint-disable */
// Code generated by scripts/generate-types.ts from lxc/incus shared/api @ ${commit}.
// DO NOT EDIT. Regenerate with: bun run generate-types

${render()}`,
);

console.log(`Wrote ${decls.size} types to ${OUT} (incus @ ${commit})`);
