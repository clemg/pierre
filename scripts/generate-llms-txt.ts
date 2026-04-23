/**
 * Shared llms.txt / llms-full.txt generator.
 *
 * Run as `bun ../../scripts/generate-llms-txt.ts <site>` from inside an app
 * package (the cwd is treated as the app root). The site argument selects which
 * `app/docs/llms-sections.ts` to import so each app keeps its section list and
 * descriptions next to the MDX they describe; this script owns *only* the MDX
 * → markdown conversion + write logic so there is one place to fix bugs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, extname, join } from 'path';
import { pathToFileURL } from 'url';

import type { LlmsSeeAlso, LlmsSiteConfig, ProductId } from './llms-types';

interface CodeExample {
  label: string;
  filename: string;
  contents: string;
}

interface Section {
  anchor: string;
  heading: string;
  description: string;
  prose: string;
  codeExamples: CodeExample[];
}

interface ResolvedProduct {
  packageName: string;
  description: string;
  docsUrl: string;
  githubUrl: string;
  sections: Section[];
  llmsTxtPath: string;
  llmsFullTxtPath: string;
  seeAlso: readonly LlmsSeeAlso[];
}

const PRODUCT_PACKAGE: Record<ProductId, string> = {
  diffs: '@pierre/diffs',
  trees: '@pierre/trees',
};

const PRODUCT_DESCRIPTION: Record<ProductId, string> = {
  diffs:
    'An open source diff and code rendering library for the web. Built on Shiki for syntax highlighting, with React and vanilla JS APIs, virtualization, SSR support, and extensive theming.',
  trees:
    'An open source file tree rendering library for the web. Built for extreme performance on large trees, with React and vanilla JS APIs, SSR support, and customizable styling.',
};

const GITHUB_URL = 'https://github.com/pierrecomputer/pierre';

const EXCLUDED_CONSTANTS = new Set([
  'WORKER_POOL_ARCHITECTURE_ASCII',
  'THEMING_PROJECT_STRUCTURE',
  'THEMING_PALETTE_COLORS',
  'THEMING_PALETTE_ROLES',
  'THEMING_PALETTE_LIGHT',
  'THEMING_PALETTE_DARK',
]);

function extToLang(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.css': 'css',
    '.json': 'json',
    '.sh': 'bash',
    '.txt': 'text',
  };
  return map[ext] ?? 'text';
}

function findOpenTagEnd(tag: string): number {
  let braceDepth = 0;
  for (let i = 0; i < tag.length; i++) {
    if (tag[i] === '{') braceDepth++;
    else if (tag[i] === '}') braceDepth--;
    else if (tag[i] === '>' && braceDepth === 0) return i;
  }
  return -1;
}

function processNotices(mdx: string): string {
  const result: string[] = [];
  let pos = 0;

  while (pos < mdx.length) {
    const noticeStart = mdx.indexOf('<Notice', pos);
    if (noticeStart === -1) {
      result.push(mdx.slice(pos));
      break;
    }

    result.push(mdx.slice(pos, noticeStart));

    const noticeEnd = mdx.indexOf('</Notice>', noticeStart);
    if (noticeEnd === -1) {
      result.push(mdx.slice(noticeStart));
      break;
    }

    const fullBlock = mdx.slice(noticeStart, noticeEnd + '</Notice>'.length);
    const isWarning = fullBlock.includes('variant="warning"');
    const tagEnd = findOpenTagEnd(fullBlock);

    if (tagEnd !== -1) {
      const inner = fullBlock
        .slice(tagEnd + 1, fullBlock.indexOf('</Notice>'))
        .trim();
      if (inner.length > 0) {
        const lines = inner.split('\n').map((l) => `> ${l.trimStart()}`);
        if (isWarning) {
          lines[0] = `> **Warning:** ${inner.split('\n')[0].trimStart()}`;
        }
        result.push(lines.join('\n'));
      }
    }

    pos = noticeEnd + '</Notice>'.length;
  }

  return result.join('');
}

function stripJsx(mdx: string): string {
  const lines = mdx.split('\n');
  const result: string[] = [];
  let inJsx = false;
  let jsxTagName = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inJsx) {
      const openMatch = trimmed.match(/^<([A-Z]\w*)/);
      if (openMatch !== null) {
        jsxTagName = openMatch[1];
        if (trimmed.endsWith('/>')) continue;
        if (trimmed.includes(`</${jsxTagName}>`)) continue;
        inJsx = true;
        continue;
      }
      result.push(line);
    } else {
      if (trimmed === '/>') {
        inJsx = false;
        continue;
      }
      if (trimmed.includes(`</${jsxTagName}>`)) {
        inJsx = false;
        continue;
      }
    }
  }

  return result.join('\n');
}

function cleanMarkdown(md: string): string {
  return md
    .replace(/\s*\[toc-ignore\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function processMdx(raw: string): string {
  return cleanMarkdown(stripJsx(processNotices(raw)));
}

function extractFirstHeading(mdxContent: string): string | null {
  return mdxContent.match(/^#{2,6}\s+(.+)/m)?.[1]?.trim() ?? null;
}

function headingToAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function formatCodeExamples(examples: CodeExample[]): string {
  if (examples.length === 0) return '';
  const blocks = examples.map((ex) => {
    const lang = extToLang(ex.filename);
    return `**${ex.label}** (\`${ex.filename}\`):\n\n\`\`\`${lang}\n${ex.contents}\n\`\`\``;
  });
  return '\n\n' + blocks.join('\n\n');
}

function hasFileContents(
  value: unknown
): value is { file: { name: string; contents: string } } {
  if (typeof value !== 'object' || value === null || !('file' in value)) {
    return false;
  }
  const file = (value as { file: unknown }).file;
  if (typeof file !== 'object' || file === null) return false;
  const f = file as { name?: unknown; contents?: unknown };
  return typeof f.contents === 'string' && typeof f.name === 'string';
}

const LABEL_OVERRIDES: Record<string, string> = {
  STYLING_CODE_GLOBAL: 'Global CSS Variables',
  STYLING_CODE_INLINE: 'Inline Styles',
  STYLING_CODE_UNSAFE: 'Unsafe CSS',
  CUSTOM_HUNK_SEPARATORS_SWITCHER: 'React Example',
  SSR_USAGE_SERVER: 'Server Component',
  SSR_USAGE_CLIENT: 'Client Component',
  THEMING_REGISTER_THEME: 'Registering Custom Themes',
  THEMING_USE_IN_COMPONENT: 'Using Custom Themes in Components',
  WORKER_POOL_USAGE: 'Basic Usage',
};

const LABEL_PREFIXES_TO_STRIP = [
  'HELPER_',
  'REACT_API_',
  'VANILLA_API_',
  'WORKER_POOL_',
  'SSR_',
  'STYLING_CODE_',
  'THEMING_',
  'VIRTUALIZATION_',
  'OVERVIEW_',
  'TREES_',
  'CUSTOM_HUNK_SEPARATORS_',
];

const WORD_REPLACEMENTS: Record<string, string> = {
  Api: 'API',
  Ssr: 'SSR',
  Css: 'CSS',
  Url: 'URL',
  Csp: 'CSP',
  Js: 'JS',
  Jsx: 'JSX',
  Tsx: 'TSX',
  Json: 'JSON',
  Html: 'HTML',
  Uri: 'URI',
  Nextjs: 'Next.js',
  Vscode: 'VSCode',
  Esbuild: 'esbuild',
};

function formatConstantName(name: string): string {
  let label = name;
  for (const prefix of LABEL_PREFIXES_TO_STRIP) {
    if (label.startsWith(prefix)) {
      label = label.slice(prefix.length);
      break;
    }
  }
  return label
    .split('_')
    .map((w) => {
      const titleCased = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      return WORD_REPLACEMENTS[titleCased] ?? titleCased;
    })
    .join(' ');
}

async function discoverCodeExamples(
  constantsPath: string
): Promise<CodeExample[]> {
  if (!existsSync(constantsPath)) return [];

  const mod = await import(pathToFileURL(constantsPath).href);
  const examples: CodeExample[] = [];

  for (const [name, value] of Object.entries(mod)) {
    if (EXCLUDED_CONSTANTS.has(name)) continue;
    if (hasFileContents(value)) {
      examples.push({
        label: LABEL_OVERRIDES[name] ?? formatConstantName(name),
        filename: value.file.name,
        contents: value.file.contents,
      });
    }
  }

  return examples;
}

async function buildSection(
  appRoot: string,
  config: LlmsSiteConfig,
  dirName: string
): Promise<Section> {
  const mdxFilename =
    config.mdxFilenameOverrides?.[`${config.docsPrefix}/${dirName}`] ??
    'content.mdx';
  const mdxPath = `${config.docsPrefix}/${dirName}/${mdxFilename}`;

  const rawMdx = readFileSync(join(appRoot, 'app', mdxPath), 'utf-8');
  const prose = processMdx(rawMdx);
  const heading =
    extractFirstHeading(prose) ?? dirName.split('/').at(-1) ?? dirName;
  const anchor = headingToAnchor(heading);

  const constantsPath = join(
    appRoot,
    'app',
    config.docsPrefix,
    dirName,
    'constants.ts'
  );
  const codeExamples = await discoverCodeExamples(constantsPath);

  const description = config.sectionDescriptions[dirName] ?? '';

  return { anchor, heading, description, prose, codeExamples };
}

function generateLlmsTxt(product: ResolvedProduct): string {
  const lines: string[] = [
    `# ${product.packageName}`,
    '',
    `> ${product.description}`,
    '',
    `- Package: \`${product.packageName}\` on [npm](https://www.npmjs.com/package/${product.packageName})`,
    `- GitHub: ${product.githubUrl}`,
    `- Install: \`npm install ${product.packageName}\``,
    '',
    '## Docs',
    '',
  ];

  for (const section of product.sections) {
    lines.push(
      `- [${section.heading}](${product.docsUrl}#${section.anchor}): ${section.description}`
    );
  }

  lines.push('', '## See also', '');
  for (const link of product.seeAlso) {
    lines.push(`- [${link.label}](${link.url}): ${link.description}`);
  }

  return lines.join('\n') + '\n';
}

function generateLlmsFullTxt(product: ResolvedProduct): string {
  const parts: string[] = [
    `# ${product.packageName}`,
    '',
    `> ${product.description}`,
    '',
    `- Package: \`${product.packageName}\` on [npm](https://www.npmjs.com/package/${product.packageName})`,
    `- GitHub: ${product.githubUrl}`,
    `- Docs: ${product.docsUrl}`,
  ];

  for (const section of product.sections) {
    const examples = formatCodeExamples(section.codeExamples);
    parts.push('', section.prose + examples);
  }

  return parts.join('\n') + '\n';
}

function parseSiteArg(): ProductId {
  const arg = process.argv[2];
  if (arg !== 'diffs' && arg !== 'trees') {
    console.error(
      `Usage: bun scripts/generate-llms-txt.ts <diffs|trees>\n` +
        `Got: ${JSON.stringify(arg)}`
    );
    process.exit(1);
  }
  return arg;
}

async function main() {
  const site = parseSiteArg();
  const appRoot = process.cwd();
  const sectionsModuleUrl = pathToFileURL(
    join(appRoot, 'app', 'docs', 'llms-sections.ts')
  ).href;
  const { llmsSections } = (await import(sectionsModuleUrl)) as {
    llmsSections: LlmsSiteConfig;
  };

  if (llmsSections.productId !== site) {
    console.error(
      `Mismatch: --site=${site} but app/docs/llms-sections.ts is for ${llmsSections.productId}.`
    );
    process.exit(1);
  }

  const sections = await Promise.all(
    llmsSections.sections.map((dir) => buildSection(appRoot, llmsSections, dir))
  );

  const product: ResolvedProduct = {
    packageName: PRODUCT_PACKAGE[site],
    description: PRODUCT_DESCRIPTION[site],
    docsUrl: llmsSections.docsUrl,
    githubUrl: GITHUB_URL,
    sections,
    llmsTxtPath: join(appRoot, llmsSections.llmsTxtPath),
    llmsFullTxtPath: join(appRoot, llmsSections.llmsFullTxtPath),
    seeAlso: llmsSections.seeAlso,
  };

  const dir = dirname(product.llmsTxtPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(product.llmsTxtPath, generateLlmsTxt(product));
  writeFileSync(product.llmsFullTxtPath, generateLlmsFullTxt(product));

  console.log(`wrote ${product.llmsTxtPath}`);
  console.log(`wrote ${product.llmsFullTxtPath}`);
}

void main();
