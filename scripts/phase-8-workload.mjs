import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

const outputArg = process.argv[2];
if (!outputArg) {
  console.error('Usage: npm run workload:phase8 -- <new-empty-output-directory>');
  process.exit(2);
}

const output = resolve(outputArg);
const sectionDirectory = resolve(output, 'sections');
const bibliographyPath = resolve(output, 'references.bib');
const pdfPath = resolve(output, 'synthetic-200-pages.pdf');
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
await mkdir(sectionDirectory);

const pad = (value) => String(value).padStart(4, '0');
const sectionCount = 1000;
const linesPerSection = 100;
const rootLines = [
  '\\documentclass{article}',
  '\\usepackage[T1]{fontenc}',
  '\\title{Synthetic Phase 8 workload}',
  '\\author{Loom test fixture}',
  '\\date{}',
  '\\begin{document}',
  '\\maketitle',
  '\\tableofcontents',
  '\\cite{Synthetic0001}',
  ...Array.from({ length: sectionCount }, (_, i) => `\\input{sections/section-${pad(i)}}`),
  '\\bibliographystyle{plain}',
  '\\bibliography{references}',
  '\\end{document}',
];
await writeFile(resolve(output, 'main.tex'), `${rootLines.join('\n')}\n`);

for (let section = 0; section < sectionCount; section++) {
  const lines = [`\\section{Synthetic section ${section + 1}}`];
  for (let line = 1; line < linesPerSection; line++) {
    lines.push(
      line % 20 === 0
        ? `Synthetic paragraph ${line} in section ${section + 1}.\\cite{Synthetic${pad((section % 5000) + 1)}}`
        : `% synthetic workload source line ${line} for section ${section + 1}`,
    );
  }
  await writeFile(
    resolve(sectionDirectory, `section-${pad(section)}.tex`),
    `${lines.join('\n')}\n`,
  );
}

const largeFileLines = [
  '\\section{Ten thousand line source file}',
  ...Array.from(
    { length: 9999 },
    (_, i) => `% large-file line ${i + 2}: synthetic navigation workload`,
  ),
];
await writeFile(resolve(sectionDirectory, 'large-file.tex'), `${largeFileLines.join('\n')}\n`);

const bibliography = Array.from(
  { length: 5000 },
  (_, i) =>
    `@article{Synthetic${pad(i + 1)},\n` +
    `  title = {Synthetic research record ${i + 1}},\n` +
    `  author = {Researcher, Ada and Scientist, Grace},\n` +
    `  journal = {Journal of Synthetic Workloads},\n` +
    `  year = {${2000 + (i % 27)}},\n` +
    `  doi = {10.5555/loom.synthetic.${i + 1}}\n` +
    `}\n`,
).join('\n');
await writeFile(bibliographyPath, bibliography);

const pdfPageCount = 200;
const objects = [
  Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
  null,
  Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
];
const pageObjectIds = [];
for (let page = 0; page < pdfPageCount; page++) {
  const pageId = objects.length + 1;
  const contentId = pageId + 1;
  pageObjectIds.push(pageId);
  objects.push(
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    ),
  );
  const stream = Buffer.from(`BT /F1 24 Tf 72 720 Td (Synthetic Phase 8 page ${page + 1}) Tj ET`);
  objects.push(
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      Buffer.from('\nendstream'),
    ]),
  );
}
objects[1] = Buffer.from(
  `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pdfPageCount} >>`,
);

const chunks = [Buffer.from('%PDF-1.4\n% synthetic workload\n')];
const offsets = [0];
let byteLength = chunks[0].length;
for (let index = 0; index < objects.length; index++) {
  offsets.push(byteLength);
  const entry = Buffer.concat([
    Buffer.from(`${index + 1} 0 obj\n`),
    objects[index],
    Buffer.from('\nendobj\n'),
  ]);
  chunks.push(entry);
  byteLength += entry.length;
}
const xrefOffset = byteLength;
const xref = [
  `xref\n0 ${objects.length + 1}\n`,
  '0000000000 65535 f \n',
  ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
  `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
  `startxref\n${xrefOffset}\n%%EOF\n`,
].join('');
chunks.push(Buffer.from(xref));
await writeFile(pdfPath, Buffer.concat(chunks));

const sourceFiles = sectionCount + 2;
const sourceLines = sectionCount * linesPerSection + rootLines.length + largeFileLines.length;
console.log(
  JSON.stringify(
    {
      project: output,
      root: relative(output, resolve(output, 'main.tex')),
      sourceFiles,
      sourceLines,
      bibliographyEntries: 5000,
      pdfPages: pdfPageCount,
      files: [bibliographyPath, pdfPath],
    },
    null,
    2,
  ),
);
