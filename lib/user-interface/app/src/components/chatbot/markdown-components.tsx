/**
 * react-markdown component overrides for assistant answers: inline [N]
 * citation badges, styled tables/code, links opening in a new tab, and
 * images rendered as links instead of being loaded.
 */
import * as React from "react";
import type { Components } from "react-markdown";
import styles from "../../styles/chat.module.scss";
import type { SourceItem } from "./chat-sources";
import { CitationBadge, MarkdownImage } from "./markdown-parts";

type ChildProps = { children?: React.ReactNode };

function renderWithCitations(
  children: React.ReactNode,
  sources: SourceItem[],
  onCitationClick?: (chunkIndex: number) => void,
  keyPrefix = "cit"
): React.ReactNode {
  if (typeof children === "string") {
    const parts = children.split(/(\[\d+\])/g);
    if (parts.length === 1) return children;
    return parts.map((part, i) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (!match) return part;
      const source = sources.find((s) => s.chunkIndex === parseInt(match[1], 10));
      // A source that was filtered out (e.g. metadata.txt) hides its dangling [N].
      return source ? (
        <CitationBadge key={`${keyPrefix}-${i}`} source={source} onCitationClick={onCitationClick} />
      ) : null;
    });
  }
  if (Array.isArray(children)) {
    return children.map((child, i) =>
      renderWithCitations(child, sources, onCitationClick, `${keyPrefix}-${i}`)
    );
  }
  if (React.isValidElement<ChildProps>(children) && children.props.children) {
    return React.cloneElement(
      children,
      { key: children.key ?? `${keyPrefix}-el` },
      renderWithCitations(children.props.children, sources, onCitationClick, `${keyPrefix}-ch`)
    );
  }
  return children;
}

type MdProps<T extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[T] & {
  node?: unknown;
};

export function buildMarkdownComponents(
  sources: SourceItem[],
  onCitationClick?: (chunkIndex: number) => void
): Components {
  const cite = (children: React.ReactNode) => renderWithCitations(children, sources, onCitationClick);
  const wrap = <T extends keyof JSX.IntrinsicElements>(Tag: T) =>
    function Wrapped({ children, node: _node, ...rest }: MdProps<T>) {
      return React.createElement(Tag, rest, cite(children as React.ReactNode));
    };

  return {
    p: wrap("p"),
    li: wrap("li"),
    h1: wrap("h1"),
    h2: wrap("h2"),
    h3: wrap("h3"),
    h4: wrap("h4"),
    h5: wrap("h5"),
    h6: wrap("h6"),
    strong: wrap("strong"),
    em: wrap("em"),
    td: ({ children, node: _node, ...rest }: MdProps<"td">) => (
      <td {...rest} className={styles.markdownTableCell}>
        {cite(children)}
      </td>
    ),
    th: ({ children, node: _node, ...rest }: MdProps<"th">) => (
      <th {...rest} className={styles.markdownTableCell}>
        {cite(children)}
      </th>
    ),
    pre: ({ children, node: _node, ...rest }: MdProps<"pre">) => (
      <pre {...rest} className={styles.codeMarkdown}>
        {children}
      </pre>
    ),
    table: ({ children, node: _node, ...rest }: MdProps<"table">) => (
      <table {...rest} className={styles.markdownTable}>
        {children}
      </table>
    ),
    a: ({ children, href, node: _node, ...rest }: MdProps<"a">) => (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    img: ({ src, alt }: MdProps<"img">) => <MarkdownImage src={src} alt={alt} />,
  };
}
