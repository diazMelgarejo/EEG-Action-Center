// Client-side state & Google Identity integration
const DEFAULT_CONFIG = {
  siteName: "Example Labs",
  sheetUrl: "",
  formUrl: "",
  driveUrl: "",
  clientId: ""
};

let userProfile = null;

function loadConfig() {
  const saved = localStorage.getItem("eeg_action_center_config");
  return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
}

function saveConfig(cfg) {
  localStorage.setItem("eeg_action_center_config", JSON.stringify(cfg));
}

function updateUI() {
  const cfg = loadConfig();
  document.getElementById("site-name").textContent = cfg.siteName || "Operational EEG Lab";

  const linkSheet = document.getElementById("link-sheet");
  const linkForm = document.getElementById("link-form");
  const linkReview = document.getElementById("link-review");
  const linkDrive = document.getElementById("link-drive");

  if (cfg.sheetUrl) {
    linkSheet.href = cfg.sheetUrl;
    linkSheet.classList.remove("disabled");
    linkReview.href = cfg.sheetUrl.includes("#gid=") ? cfg.sheetUrl : `${cfg.sheetUrl}#gid=Review`;
    linkReview.classList.remove("disabled");
  } else {
    linkSheet.classList.add("disabled");
    linkReview.classList.add("disabled");
  }

  if (cfg.formUrl) {
    linkForm.href = cfg.formUrl;
    linkForm.classList.remove("disabled");
  } else {
    linkForm.classList.add("disabled");
  }

  if (cfg.driveUrl) {
    linkDrive.href = cfg.driveUrl;
    linkDrive.classList.remove("disabled");
  } else {
    linkDrive.classList.add("disabled");
  }

  renderLabTiles(25);
}

function renderLabTiles(count) {
  const grid = document.getElementById("labs-grid");
  grid.innerHTML = "";
  for (let i = 1; i <= count; i++) {
    const tile = document.createElement("div");
    tile.className = "lab-tile";
    tile.innerHTML = `<div class="lab-name">Lab ${i}</div><div class="lab-serial">empty</div>`;
    grid.appendChild(tile);
  }
}

function handleCredentialResponse(response) {
  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    userProfile = { email: payload.email, name: payload.name };
    onUserSignedIn(userProfile);
  } catch (e) {
    console.error("Failed to parse token payload", e);
  }
}

function onUserSignedIn(user) {
  document.getElementById("auth-gate").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  document.getElementById("google-signin-btn").classList.add("hidden");

  const profBox = document.getElementById("user-profile");
  profBox.classList.remove("hidden");
  document.getElementById("user-email").textContent = user.email;
  document.getElementById("site-domain").textContent = `Authenticated: ${user.email}`;
}

function initAuth() {
  const cfg = loadConfig();
  const clientId = cfg.clientId || "sample-client-id.apps.googleusercontent.com";

  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredentialResponse
    });
    google.accounts.id.renderButton(
      document.getElementById("gate-signin-btn"),
      { theme: "outline", size: "large" }
    );
  }
}

document.addEventListener("DOMContentLoaded", () => {
  updateUI();

  document.getElementById("config-btn").addEventListener("click", () => {
    const cfg = loadConfig();
    document.getElementById("cfg-site").value = cfg.siteName || "";
    document.getElementById("cfg-sheet").value = cfg.sheetUrl || "";
    document.getElementById("cfg-form").value = cfg.formUrl || "";
    document.getElementById("cfg-drive").value = cfg.driveUrl || "";
    document.getElementById("cfg-client-id").value = cfg.clientId || "";
    document.getElementById("config-modal").classList.remove("hidden");
  });

  const closeModal = () => document.getElementById("config-modal").classList.add("hidden");
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("cfg-cancel").addEventListener("click", closeModal);

  document.getElementById("config-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveConfig({
      siteName: document.getElementById("cfg-site").value.trim(),
      sheetUrl: document.getElementById("cfg-sheet").value.trim(),
      formUrl: document.getElementById("cfg-form").value.trim(),
      driveUrl: document.getElementById("cfg-drive").value.trim(),
      clientId: document.getElementById("cfg-client-id").value.trim()
    });
    closeModal();
    updateUI();
  });

  document.getElementById("signout-btn").addEventListener("click", () => {
    userProfile = null;
    document.getElementById("auth-gate").classList.remove("hidden");
    document.getElementById("dashboard").classList.add("hidden");
    document.getElementById("user-profile").classList.add("hidden");
    document.getElementById("google-signin-btn").classList.remove("hidden");
  });

  window.addEventListener("load", initAuth);
});