// The public dashboard. It holds no company data and no access control: Google enforces access on every linked file.
// Links stay in memory for this visit only, so nothing private is left in the browser or in this repository.
const LEGACY_CONFIG_KEY = "eeg_action_center_config"; // an earlier version saved links here; erased on load
const GOOGLE_HOSTS = ["docs.google.com", "drive.google.com", "forms.gle"];
const LINK_FIELDS = [
  { link: "link-form", input: "cfg-form", key: "formUrl" },
  { link: "link-sheet", input: "cfg-sheet", key: "sheetUrl" },
  { link: "link-review", input: "cfg-review", key: "reviewUrl" },
  { link: "link-drive", input: "cfg-drive", key: "driveUrl" }
];

let siteConfig = {};

function eraseSavedConfig() {
  try {
    localStorage.removeItem(LEGACY_CONFIG_KEY);
  } catch (error) {
    console.warn("Browser storage is blocked, so there is nothing to erase.", error);
  }
}

function isGoogleLink(text) {
  try {
    const url = new URL(text);
    return url.protocol === "https:" && GOOGLE_HOSTS.includes(url.hostname);
  } catch (error) {
    return false;
  }
}

function updateLink({ link, key }) {
  const element = document.getElementById(link);
  const url = siteConfig[key];
  element.classList.toggle("disabled", !url);
  if (url) {
    element.href = url;
  } else {
    element.removeAttribute("href");
  }
}

function updateUI() {
  document.getElementById("site-name").textContent = siteConfig.siteName || "No site set";
  LINK_FIELDS.forEach(updateLink);
}

function fillForm() {
  document.getElementById("cfg-site").value = siteConfig.siteName || "";
  LINK_FIELDS.forEach(({ input, key }) => {
    document.getElementById(input).value = siteConfig[key] || "";
  });
  document.getElementById("cfg-error").textContent = "";
}

function readForm() {
  const links = Object.fromEntries(LINK_FIELDS.map(({ input, key }) => [key, document.getElementById(input).value.trim()]));
  return { siteName: document.getElementById("cfg-site").value.trim(), ...links };
}

function badLinks(config) {
  return LINK_FIELDS.filter(({ key }) => config[key] && !isGoogleLink(config[key]));
}

document.addEventListener("DOMContentLoaded", () => {
  eraseSavedConfig();
  updateUI();

  const modal = document.getElementById("config-modal");
  const closeModal = () => modal.classList.add("hidden");

  document.getElementById("config-btn").addEventListener("click", () => {
    fillForm();
    modal.classList.remove("hidden");
  });
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("cfg-cancel").addEventListener("click", closeModal);

  document.getElementById("config-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const config = readForm();
    if (badLinks(config).length) {
      document.getElementById("cfg-error").textContent = "Use https links on docs.google.com, drive.google.com or forms.gle.";
      return;
    }
    siteConfig = config;
    closeModal();
    updateUI();
  });
});
