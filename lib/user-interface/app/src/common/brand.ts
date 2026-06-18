/* AUTO-GENERATED from config/brand.ts by `npm run brand:sync`. Do not edit by hand. */
export const brand = {
  "assistantName": "Sonar",
  "organizationName": "Burnes Center for Social Change",
  "parentOrg": "Northeastern University",
  "tagline": "Ask anything about your knowledge base.",
  "welcomeMessage": "What can I help you with?",
  "suggestedPrompts": [
    "Summarize the most recent document.",
    "What topics can you help me with?",
    "Find information about a specific subject.",
    "What documents are in the knowledge base?"
  ],
  "supportContact": "your administrator",
  "colorsLight": {
    "primary": "#C8102E",
    "primaryDark": "#A00C24",
    "primaryLight": "#FCE8EB",
    "primaryContrast": "#FFFFFF",
    "secondary": "#297496",
    "secondaryLight": "#E6F0F4",
    "headerBg": "#0C3354",
    "headerText": "#FFFFFF",
    "chatHumanBg": "#0C3354",
    "chatHumanText": "#FFFFFF",
    "info": "#297496",
    "infoLight": "#E6F0F4"
  },
  "colorsDark": {
    "primary": "#EF5A6F",
    "primaryDark": "#C8102E",
    "primaryLight": "#3A1620",
    "primaryContrast": "#1A0E12",
    "secondary": "#4FA3C7",
    "secondaryLight": "#10242E",
    "headerBg": "#07223B",
    "headerText": "#E8EDF2",
    "chatHumanBg": "#15406B",
    "chatHumanText": "#E8EDF2",
    "info": "#4FA3C7",
    "infoLight": "#0D1F3A"
  },
  "fontFamily": "\"Libre Franklin\", \"Helvetica Neue\", Arial, sans-serif",
  "fontUrl": "https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@300;400;500;600;700&display=swap",
  "assets": {
    "logo": "/images/logo.svg",
    "logoDark": "/images/logo-white.svg",
    "favicon": "/images/icon.svg",
    "icon": "/images/icon.svg"
  },
  "themeColorLight": "#FFFFFF",
  "themeColorDark": "#0C3354"
} as const;

export type Brand = typeof brand;
export default brand;
