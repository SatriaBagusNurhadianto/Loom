// Synthetic read-only reference material. No document or filesystem state is created.
export const exampleSource = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}

% Core packages
\usepackage{amsmath,amssymb}
\usepackage{tikz-cd}
\usepackage{multicol}

% Paragraphs
\setlength{\parindent}{0pt}
\setlength{\parskip}{1\baselineskip}

\title{Untitled}
\author{Loom Example}
\date{\today}

\begin{document}
\maketitle

\section{Introduction}

\end{document}`;
export function tokenize(line: string): { text: string; kind: string }[] {
  return line
    .split(/(\\[a-zA-Z]+|[{}]|\[[^\]]*\]|%.*$)/g)
    .filter(Boolean)
    .map((text) => ({
      text,
      kind: text.startsWith('%')
        ? 'comment'
        : text.startsWith('\\')
          ? 'command'
          : /^[{}]$/.test(text)
            ? 'brace'
            : text.startsWith('[')
              ? 'option'
              : '',
    }));
}
