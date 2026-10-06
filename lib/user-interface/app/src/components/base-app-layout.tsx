import { ReactElement, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import NavigationPanel from "./navigation-panel";
import { SessionRefreshContext } from "../common/session-refresh-context";
import { NotificationProvider } from "./notif-manager";
import NotificationBar from "./notif-flashbar";
import { DRAWER_WIDTH } from "../common/theme";
import GlobalHeader from "./global-header";
import { StorageHelper } from "../common/helpers/storage-helper";

interface BaseAppLayoutProps {
  children?: ReactElement | ReactElement[];
}

export default function BaseAppLayout({ children }: BaseAppLayoutProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(
    () => StorageHelper.getNavigationPanelState().collapsed ?? false,
  );
  const [needsRefresh, setNeedsRefresh] = useState(true);

  // The mobile drawer is an overlay: close it once the user picks a destination.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleMenuClick = () => {
    if (isMobile) {
      setMobileOpen((v) => !v);
    } else {
      setDesktopCollapsed((prev) => {
        const next = !prev;
        StorageHelper.setNavigationPanelState({ collapsed: next });
        return next;
      });
    }
  };

  return (
    <SessionRefreshContext.Provider value={{ needsRefresh, setNeedsRefresh }}>
      <NotificationProvider>
        {/* The whole shell fits in one viewport with the body as the only
            scrollable region. */}
        <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <GlobalHeader
            onMenuClick={handleMenuClick}
            menuExpanded={isMobile ? mobileOpen : !desktopCollapsed}
          />

          <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
            {/* Only one NavigationPanel is mounted at a time, so sessions load once. */}
            {isMobile ? (
              <Drawer
                variant="temporary"
                open={mobileOpen}
                onClose={() => setMobileOpen(false)}
                ModalProps={{ keepMounted: true }}
                PaperProps={{ "aria-label": "Main navigation" }}
                sx={{
                  // Above the sticky AppBar so the panel's top isn't hidden behind it.
                  zIndex: (t) => t.zIndex.modal,
                  "& .MuiDrawer-paper": { width: DRAWER_WIDTH, maxWidth: "85vw", boxSizing: "border-box" },
                }}
              >
                <NavigationPanel />
              </Drawer>
            ) : (
              <Drawer
                variant="permanent"
                sx={{
                  display: desktopCollapsed ? "none" : "block",
                  width: DRAWER_WIDTH,
                  flexShrink: 0,
                  "& .MuiDrawer-paper": {
                    width: DRAWER_WIDTH,
                    boxSizing: "border-box",
                    position: "static",
                    height: "100%",
                  },
                }}
              >
                <NavigationPanel />
              </Drawer>
            )}

            {/* Main content. minWidth 0 lets it shrink below its content's
                intrinsic width instead of pushing the page sideways. */}
            <Box
              component="main"
              id="main-content"
              tabIndex={-1}
              sx={{
                flexGrow: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                "&:focus:not(:focus-visible)": { outline: "none" },
                minHeight: 0,
              }}
            >
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  px: { xs: 2, sm: 2.5, md: 3 },
                  pt: { xs: 2, sm: 2.5, md: 3 },
                  pb: 0,
                  width: "100%",
                  overflow: "auto",
                }}
              >
                <NotificationBar />
                {children}
              </Box>
            </Box>
          </Box>
        </Box>
      </NotificationProvider>
    </SessionRefreshContext.Provider>
  );
}
