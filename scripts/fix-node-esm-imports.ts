import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import ts from 'typescript'

const distDir = resolve(process.cwd(), process.argv[2] ?? 'dist')

function javascriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return javascriptFiles(path)
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : []
  })
}

function moduleSpecifiers(sourceFile: ts.SourceFile): ts.StringLiteral[] {
  const specifiers: ts.StringLiteral[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      specifiers.push(node.arguments[0]!)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function resolvedSpecifier(file: string, specifier: string): string {
  if (!specifier.startsWith('.') || extname(specifier)) return specifier
  const target = resolve(dirname(file), specifier)
  if (existsSync(`${target}.js`)) return `${specifier}.js`
  if (existsSync(join(target, 'index.js'))) return `${specifier.replace(/\/$/, '')}/index.js`
  throw new Error(`Cannot resolve extensionless ESM import ${specifier} from ${file}`)
}

for (const file of javascriptFiles(distDir)) {
  const source = readFileSync(file, 'utf8')
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const replacements = moduleSpecifiers(parsed)
    .map((node) => ({
      start: node.getStart(parsed) + 1,
      end: node.getEnd() - 1,
      value: resolvedSpecifier(file, node.text),
    }))
    .filter((replacement) => source.slice(replacement.start, replacement.end) !== replacement.value)
    .sort((a, b) => b.start - a.start)

  let rewritten = source
  for (const replacement of replacements) {
    rewritten =
      rewritten.slice(0, replacement.start) + replacement.value + rewritten.slice(replacement.end)
  }
  if (rewritten !== source) writeFileSync(file, rewritten)
}
