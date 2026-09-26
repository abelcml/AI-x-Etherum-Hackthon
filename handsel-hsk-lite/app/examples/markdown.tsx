import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Renders a scenario's markdown with the site's design tokens. Server
 * component — react-markdown runs at build (the /examples routes are static),
 * so nothing ships to the client. Building React elements (never innerHTML)
 * means literal `<TOKEN>` / `<details>` in the docs render as plain text, not
 * markup — safe by construction.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-foreground/90">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: () => null, // the page header already shows the title
          h2: (p) => <h2 className="mt-8 border-b border-border pb-1.5 text-lg font-bold text-foreground" {...p} />,
          h3: (p) => <h3 className="mt-6 text-base font-semibold text-foreground" {...p} />,
          p: (p) => <p className="text-muted-foreground" {...p} />,
          a: (p) => <a className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary" target="_blank" rel="noreferrer" {...p} />,
          strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
          ul: (p) => <ul className="ml-1 space-y-1.5 [&>li]:relative [&>li]:pl-5 [&>li]:before:absolute [&>li]:before:left-1 [&>li]:before:text-primary [&>li]:before:content-['•']" {...p} />,
          ol: (p) => <ol className="ml-5 list-decimal space-y-1.5 marker:text-muted-foreground" {...p} />,
          li: (p) => <li className="text-muted-foreground" {...p} />,
          blockquote: (p) => (
            <blockquote className="rounded-r-lg border-l-2 border-primary/50 bg-secondary/30 px-4 py-2 text-muted-foreground [&_p]:my-1" {...p} />
          ),
          hr: () => <hr className="my-6 border-border" />,
          code: ({ className, children, ...rest }) => {
            const inline = !String(className ?? '').includes('language-')
            if (inline) {
              return (
                <code className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground" {...rest}>
                  {children}
                </code>
              )
            }
            return <code className={className} {...rest}>{children}</code>
          },
          pre: (p) => (
            <pre className="overflow-x-auto rounded-xl border border-border bg-[#0b0e14] p-4 font-mono text-[13px] leading-relaxed text-[#d6deeb] [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit" {...p} />
          ),
          table: (p) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm" {...p} />
            </div>
          ),
          thead: (p) => <thead className="border-b border-border" {...p} />,
          th: (p) => <th className="px-3 py-2 font-semibold text-foreground" {...p} />,
          td: (p) => <td className="border-b border-border/60 px-3 py-2 align-top text-muted-foreground" {...p} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
