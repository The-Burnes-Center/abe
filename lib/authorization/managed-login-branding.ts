// Cognito Managed Login (hosted UI) branding — white-labeled.
// Colors derive from config/brand.ts so the login screen matches the app.
// Cognito expects 8-digit hex (RGBA, no leading "#").
import { brand } from "../../config/brand";

/** "#RRGGBB" -> "rrggbbaa" (Cognito's hex form, no leading #). */
const hex8 = (hex: string, alpha = "ff"): string =>
  hex.replace(/^#/, "").toLowerCase() + alpha;

const BRAND_PRIMARY = hex8(brand.colorsLight.primary);
const BRAND_PRIMARY_DARK = hex8(brand.colorsLight.primaryDark);
const BRAND_PRIMARY_TINT = hex8(brand.colorsLight.primaryLight);
// Deeper tints/shades for active+hover fills — shades of the brand primary.
const BRAND_PRIMARY_TINT_DEEP = hex8("#F6D0D6");
const BRAND_PRIMARY_DM = hex8(brand.colorsDark.primary);
const BRAND_PRIMARY_DM_HOVER = hex8("#F47E8E");
const BRAND_PRIMARY_DM_ACTIVE = hex8(brand.colorsDark.primaryDark);

export const MANAGED_LOGIN_BRANDING_SETTINGS = {
  categories: {
    auth: {
      authMethodOrder: [
        [
          { display: "BUTTON", type: "FEDERATED" },
          { display: "INPUT", type: "USERNAME_PASSWORD" },
        ],
      ],
      federation: {
        interfaceStyle: "BUTTON_LIST",
        order: [],
      },
    },
    form: {
      displayGraphics: false,
      instructions: { enabled: false },
      languageSelector: { enabled: false },
      location: { horizontal: "CENTER", vertical: "CENTER" },
      sessionTimerDisplay: "NONE",
    },
    global: {
      colorSchemeMode: "LIGHT",
      pageFooter: { enabled: false },
      pageHeader: { enabled: false },
      spacingDensity: "REGULAR",
    },
    signUp: {
      acceptanceElements: [{ enforcement: "NONE", textKey: "en" }],
    },
  },
  componentClasses: {
    buttons: { borderRadius: 4.0 },
    divider: {
      darkMode: { borderColor: "232b37ff" },
      lightMode: { borderColor: "ebebf0ff" },
    },
    dropDown: {
      borderRadius: 4.0,
      darkMode: {
        defaults: { itemBackgroundColor: "192534ff" },
        hover: {
          itemBackgroundColor: "081120ff",
          itemBorderColor: "5f6b7aff",
          itemTextColor: "e9ebedff",
        },
        match: {
          itemBackgroundColor: "d1d5dbff",
          itemTextColor: BRAND_PRIMARY_DM_HOVER,
        },
      },
      lightMode: {
        defaults: { itemBackgroundColor: "ffffffff" },
        hover: {
          itemBackgroundColor: "f4f4f4ff",
          itemBorderColor: "7d8998ff",
          itemTextColor: "000716ff",
        },
        match: {
          itemBackgroundColor: "414d5cff",
          itemTextColor: BRAND_PRIMARY,
        },
      },
    },
    focusState: {
      darkMode: { borderColor: BRAND_PRIMARY_DM },
      lightMode: { borderColor: BRAND_PRIMARY },
    },
    idpButtons: {
      icons: { enabled: true },
    },
    input: {
      borderRadius: 4.0,
      darkMode: {
        defaults: { backgroundColor: "0f1b2aff", borderColor: "5f6b7aff" },
        placeholderColor: "8d99a8ff",
      },
      lightMode: {
        defaults: { backgroundColor: "ffffffff", borderColor: "7d8998ff" },
        placeholderColor: "5f6b7aff",
      },
    },
    inputDescription: {
      darkMode: { textColor: "8d99a8ff" },
      lightMode: { textColor: "5f6b7aff" },
    },
    inputLabel: {
      darkMode: { textColor: "d1d5dbff" },
      lightMode: { textColor: "000716ff" },
    },
    link: {
      darkMode: {
        defaults: { textColor: BRAND_PRIMARY_DM },
        hover: { textColor: BRAND_PRIMARY_DM_HOVER },
      },
      lightMode: {
        defaults: { textColor: BRAND_PRIMARY },
        hover: { textColor: BRAND_PRIMARY_DARK },
      },
    },
    optionControls: {
      darkMode: {
        defaults: { backgroundColor: "0f1b2aff", borderColor: "7d8998ff" },
        selected: {
          backgroundColor: BRAND_PRIMARY_DM,
          foregroundColor: "000716ff",
        },
      },
      lightMode: {
        defaults: { backgroundColor: "ffffffff", borderColor: "7d8998ff" },
        selected: {
          backgroundColor: BRAND_PRIMARY,
          foregroundColor: "ffffffff",
        },
      },
    },
    statusIndicator: {
      darkMode: {
        error: {
          backgroundColor: "1a0000ff",
          borderColor: "eb6f6fff",
          indicatorColor: "eb6f6fff",
        },
        pending: { indicatorColor: "AAAAAAAA" },
        success: {
          backgroundColor: "001a02ff",
          borderColor: "29ad32ff",
          indicatorColor: "29ad32ff",
        },
        warning: {
          backgroundColor: "1d1906ff",
          borderColor: "e0ca57ff",
          indicatorColor: "e0ca57ff",
        },
      },
      lightMode: {
        error: {
          backgroundColor: "fff7f7ff",
          borderColor: "d91515ff",
          indicatorColor: "d91515ff",
        },
        pending: { indicatorColor: "AAAAAAAA" },
        success: {
          backgroundColor: "f2fcf3ff",
          borderColor: "037f0cff",
          indicatorColor: "037f0cff",
        },
        warning: {
          backgroundColor: "fffce9ff",
          borderColor: "8d6605ff",
          indicatorColor: "8d6605ff",
        },
      },
    },
  },
  components: {
    alert: {
      borderRadius: 8.0,
      darkMode: {
        error: { backgroundColor: "1a0000ff", borderColor: "eb6f6fff" },
      },
      lightMode: {
        error: { backgroundColor: "fff7f7ff", borderColor: "d91515ff" },
      },
    },
    favicon: {
      enabledTypes: ["ICO", "SVG"],
    },
    form: {
      backgroundImage: { enabled: false },
      borderRadius: 8.0,
      darkMode: { backgroundColor: "0f1b2aff", borderColor: "424650ff" },
      lightMode: { backgroundColor: "ffffffff", borderColor: "c6c6cdff" },
      logo: {
        enabled: true,
        formInclusion: "IN",
        location: "CENTER",
        position: "TOP",
      },
    },
    idpButton: {
      custom: {},
      standard: {
        darkMode: {
          active: {
            backgroundColor: "354150ff",
            borderColor: BRAND_PRIMARY_DM_HOVER,
            textColor: BRAND_PRIMARY_DM_HOVER,
          },
          defaults: {
            backgroundColor: "0f1b2aff",
            borderColor: BRAND_PRIMARY_DM,
            textColor: BRAND_PRIMARY_DM,
          },
          hover: {
            backgroundColor: "192534ff",
            borderColor: BRAND_PRIMARY_DM_HOVER,
            textColor: BRAND_PRIMARY_DM_HOVER,
          },
        },
        lightMode: {
          active: {
            backgroundColor: BRAND_PRIMARY_TINT_DEEP,
            borderColor: BRAND_PRIMARY_DARK,
            textColor: BRAND_PRIMARY_DARK,
          },
          defaults: {
            backgroundColor: "ffffffff",
            borderColor: BRAND_PRIMARY,
            textColor: BRAND_PRIMARY,
          },
          hover: {
            backgroundColor: BRAND_PRIMARY_TINT,
            borderColor: BRAND_PRIMARY_DARK,
            textColor: BRAND_PRIMARY_DARK,
          },
        },
      },
    },
    pageBackground: {
      darkMode: { color: "0f1b2dff" },
      image: { enabled: false },
      lightMode: { color: "f5f6f7ff" },
    },
    pageFooter: {
      backgroundImage: { enabled: false },
      darkMode: {
        background: { color: "0f141aff" },
        borderColor: "424650ff",
      },
      lightMode: {
        background: { color: "fafafaff" },
        borderColor: "d5dbdbff",
      },
      logo: { enabled: false, location: "START" },
    },
    pageHeader: {
      backgroundImage: { enabled: false },
      darkMode: {
        background: { color: "0f141aff" },
        borderColor: "424650ff",
      },
      lightMode: {
        background: { color: "fafafaff" },
        borderColor: "d5dbdbff",
      },
      logo: { enabled: false, location: "START" },
    },
    pageText: {
      darkMode: {
        bodyColor: "b6bec9ff",
        descriptionColor: "b6bec9ff",
        headingColor: "d1d5dbff",
      },
      lightMode: {
        bodyColor: "414d5cff",
        descriptionColor: "414d5cff",
        headingColor: "000716ff",
      },
    },
    phoneNumberSelector: { displayType: "TEXT" },
    primaryButton: {
      darkMode: {
        active: { backgroundColor: BRAND_PRIMARY_DM_ACTIVE, textColor: "0f1b2dff" },
        defaults: { backgroundColor: BRAND_PRIMARY_DM, textColor: "0f1b2dff" },
        disabled: { backgroundColor: "ffffffff", borderColor: "ffffffff" },
        hover: { backgroundColor: BRAND_PRIMARY_DM_HOVER, textColor: "0f1b2dff" },
      },
      lightMode: {
        active: { backgroundColor: BRAND_PRIMARY_DARK, textColor: "ffffffff" },
        defaults: { backgroundColor: BRAND_PRIMARY, textColor: "ffffffff" },
        disabled: { backgroundColor: "ffffffff", borderColor: "ffffffff" },
        hover: { backgroundColor: BRAND_PRIMARY_DARK, textColor: "ffffffff" },
      },
    },
    secondaryButton: {
      darkMode: {
        active: {
          backgroundColor: "354150ff",
          borderColor: BRAND_PRIMARY_DM_HOVER,
          textColor: BRAND_PRIMARY_DM_HOVER,
        },
        defaults: {
          backgroundColor: "0f1b2aff",
          borderColor: BRAND_PRIMARY_DM,
          textColor: BRAND_PRIMARY_DM,
        },
        hover: {
          backgroundColor: "192534ff",
          borderColor: BRAND_PRIMARY_DM_HOVER,
          textColor: BRAND_PRIMARY_DM_HOVER,
        },
      },
      lightMode: {
        active: {
          backgroundColor: BRAND_PRIMARY_TINT_DEEP,
          borderColor: BRAND_PRIMARY_DARK,
          textColor: BRAND_PRIMARY_DARK,
        },
        defaults: {
          backgroundColor: "ffffffff",
          borderColor: BRAND_PRIMARY,
          textColor: BRAND_PRIMARY,
        },
        hover: {
          backgroundColor: BRAND_PRIMARY_TINT,
          borderColor: BRAND_PRIMARY_DARK,
          textColor: BRAND_PRIMARY_DARK,
        },
      },
    },
  },
};
