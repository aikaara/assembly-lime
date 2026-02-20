import Markdown from "react-markdown";

export function MarkdownContent({ text }: { text: string }) {
  return (
    <Markdown
      components={{
        h1: ({ children }) => (
          <h1 className="text-lg font-semibold text-zinc-100 mt-4 mb-2 first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base font-semibold text-zinc-100 mt-3 mb-1.5 first:mt-0">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-semibold text-zinc-200 mt-2 mb-1 first:mt-0">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="text-sm text-zinc-300 leading-relaxed mb-2 last:mb-0">
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside text-sm text-zinc-300 space-y-0.5 mb-2 pl-1">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside text-sm text-zinc-300 space-y-0.5 mb-2 pl-1">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
          >
            {children}
          </a>
        ),
        code: ({ className, children }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <code className="block rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-xs font-mono text-zinc-300 overflow-x-auto my-2">
                {children}
              </code>
            );
          }
          return (
            <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-mono text-emerald-400">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <pre className="my-2">{children}</pre>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-zinc-600 pl-3 text-sm text-zinc-400 italic my-2">
            {children}
          </blockquote>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-zinc-200">{children}</strong>
        ),
        hr: () => <hr className="border-zinc-800 my-3" />,
      }}
    >
      {text}
    </Markdown>
  );
}
