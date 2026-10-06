/* AUTO-GENERATED from config/brand.ts by `npm run brand:sync`. Do not edit by hand. */
export const brand = {
  "slug": "abe",
  "assistantName": "ABE",
  "shortName": "ABE",
  "organizationName": "AI for Impact",
  "parentOrg": "",
  "tagline": "Ask anything about your knowledge base.",
  "welcomeMessage": "What can I help you with?",
  "suggestedPrompts": [
    "Summarize the most recent document.",
    "What topics can you help me with?",
    "Find information about a specific subject.",
    "What documents are in the knowledge base?"
  ],
  "supportContact": "your administrator",
  "timezone": "America/New_York",
  "colorsLight": {
    "primary": "#376BD1",
    "primaryDark": "#2B56AD",
    "primaryLight": "#F0F4FD",
    "primaryContrast": "#FFFFFF",
    "secondary": "#1F2D45",
    "secondaryLight": "#EEF3FF",
    "headerBg": "#1F2D45",
    "headerText": "#FFFFFF",
    "chatHumanBg": "#1F2D45",
    "chatHumanText": "#FFFFFF",
    "info": "#2F62C9",
    "infoLight": "#EEF3FF"
  },
  "colorsDark": {
    "primary": "#6A9CFF",
    "primaryDark": "#4F86F0",
    "primaryLight": "#1A2A4A",
    "primaryContrast": "#0B1220",
    "secondary": "#9DBEFF",
    "secondaryLight": "#16233B",
    "headerBg": "#141D2E",
    "headerText": "#F8F6F1",
    "chatHumanBg": "#2A3D5E",
    "chatHumanText": "#F8F6F1",
    "info": "#6A9CFF",
    "infoLight": "#13213A"
  },
  "fontFamily": "\"Public Sans\", system-ui, -apple-system, \"Segoe UI\", sans-serif",
  "fontUrl": "https://fonts.googleapis.com/css2?family=Public+Sans:wght@300..700&display=swap",
  "assets": {
    "logo": "/images/logo.svg",
    "logoDark": "/images/logo-white.svg",
    "favicon": "/images/icon.svg",
    "icon": "/images/icon.svg",
    "demoVideo": "/demos/demo.mp4"
  },
  "themeColorLight": "#FFFFFF",
  "themeColorDark": "#1F2D45"
} as const;

export type Brand = typeof brand;
export default brand;
