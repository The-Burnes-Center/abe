/** Collapsible "N documents referenced" list under an assistant answer. */
import { forwardRef, useId } from "react";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import styles from "../../styles/chat.module.scss";
import { formatPageList, type SourceGroup } from "./chat-sources";

interface SourcesPanelProps {
  groups: SourceGroup[];
  open: boolean;
  onToggle: () => void;
  highlightedChunk: number | null;
  /** Opens a document through the presign endpoint using its S3 key. */
  onOpenSource?: (s3Key: string) => void;
}

const SourcesPanel = forwardRef<HTMLDivElement, SourcesPanelProps>(function SourcesPanel(
  { groups, open, onToggle, highlightedChunk, onOpenSource },
  listRef
) {
  const listId = useId();

  return (
    <Box sx={{ mt: 1 }}>
      <button
        type="button"
        className={styles.sourcesToggle}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={listId}
      >
        <DescriptionOutlinedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
        <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.8125rem" }}>
          {groups.length} document{groups.length !== 1 ? "s" : ""} referenced
        </Typography>
        <ExpandMoreIcon
          sx={{
            fontSize: 18,
            color: "text.secondary",
            transition: "transform 200ms ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>
      <Collapse in={open} timeout={200}>
        <div id={listId} className={styles.sourcesList} ref={listRef}>
          {groups.map((group, gi) => {
            const allChunkIndices = group.cards.flatMap((c) => c.chunkIndices);
            const allPages = [
              ...new Set(group.cards.map((c) => c.page).filter((p): p is number => p != null)),
            ].sort((a, b) => a - b);
            const isHighlighted = highlightedChunk != null && allChunkIndices.includes(highlightedChunk);
            // Stored history keeps the S3 key but not a presigned URL (those
            // expire), so prefer the key; a live `uri` is only a fallback.
            const legacyUri = group.cards[0]?.uri ?? null;
            const canOpen = Boolean((group.s3Key && onOpenSource) || legacyUri);
            const openSource = () => {
              if (group.s3Key && onOpenSource) {
                onOpenSource(group.s3Key);
              } else if (legacyUri) {
                window.open(legacyUri, "_blank", "noopener,noreferrer");
              }
            };
            return (
              <button
                key={`group-${gi}`}
                type="button"
                className={`${styles.sourceRow} ${isHighlighted ? styles.sourceRowHighlight : ""}`}
                data-chunk-indices={allChunkIndices.join(" ")}
                onClick={canOpen ? openSource : undefined}
                disabled={!canOpen}
                aria-label={canOpen ? `Open ${group.documentTitle}` : group.documentTitle}
              >
                {group.sourceType === "excelIndex" ? (
                  <TableChartOutlinedIcon className={styles.sourceRowIcon} />
                ) : (
                  <DescriptionOutlinedIcon className={styles.sourceRowIcon} />
                )}
                <div className={styles.sourceRowBody}>
                  <Typography variant="body2" className={styles.sourceRowTitle} noWrap>
                    {group.documentTitle}
                  </Typography>
                  {allPages.length > 0 && (
                    <Typography variant="caption" className={styles.sourceRowMeta}>
                      {formatPageList(allPages)}
                    </Typography>
                  )}
                </div>
                {canOpen && <OpenInNewIcon className={styles.sourceRowOpen} />}
              </button>
            );
          })}
        </div>
      </Collapse>
    </Box>
  );
});

export default SourcesPanel;
