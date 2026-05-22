require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const formData = require("form-data");
const Mailgun = require("mailgun.js");
const multer = require("multer");
const sharp = require("sharp");
const { Readable } = require("stream");
const PDFDocument = require("pdfkit");
const { google } = require("googleapis");

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: "api",
  key: process.env.MAILGUN_API_KEY || "",
  url: process.env.MAILGUN_EU ? "https://api.eu.mailgun.net" : "https://api.mailgun.net",
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const CONDITION_LABELS = {
  cond_high_bp: "Hypertension",
  cond_cholesterol: "Dyslipidemia",
  cond_diabetes: "Diabetes",
  cond_erectile_dysfunction: "Erectile dysfunction",
  cond_menopausal: "Post-menopausal",
  cond_stroke: "Stroke",
  cond_sleep_apnea: "Sleep apnea",
  cond_kidney_disease: "Kidney disease",
  cond_heart_attack: "Myocardial infarction",
  cond_angina: "Angina",
  cond_angioplasty: "Coronary angioplasty/stenting",
  cond_cabg: "Coronary artery bypass grafting",
  cond_valve_surgery: "Valve surgery",
  cond_defib: "ICD",
  cond_pacemaker: "Pacemaker",
  cond_atrial_fib: "Atrial fibrillation",
  cond_heart_failure: "Heart failure",
  cond_asthma: "Asthma",
  cond_copd: "COPD",
  cond_emphysema: "Emphysema",
  cond_pulmonary_embolism: "Pulmonary embolism",
  cond_pulmonary_fibrosis: "Interstitial pulmonary fibrosis",
  cond_heart_burn: "Gastroesophageal reflux",
  cond_ibs: "Irritable bowel syndrome",
  cond_ulcerative_colitis: "Ulcerative colitis",
  cond_crohns: "Crohn's disease",
  cond_celiac: "Celiac disease",
  cond_fatty_liver: "Fatty liver disease",
  cond_cirrhosis: "Liver cirrhosis",
  cond_hep_c: "Hepatitis C",
  cond_anxiety: "Anxiety",
  cond_depression: "Depression",
  cond_panic_attacks: "Panic attacks",
  cond_ptsd: "Post Traumatic Stress Disorder",
  cond_schizophrenia: "Schizophrenia",
  cond_bipolar: "Bipolar disorder",
  cond_osteoarthritis: "Osteoarthritis",
  cond_rheumatoid_arthritis: "Rheumatoid arthritis",
  cond_gout: "Gout",
  cond_osteoporosis: "Osteoporosis",
  cond_lupus: "Systemic lupus",
  cond_chronic_pain: "Chronic pain",
  cond_chronic_fatigue: "Chronic fatigue syndrome",
  cond_hypothyroidism: "Hypothyroidism",
  cond_hyperthyroidism: "Hyperthyroidism",
  cond_thyroid_nodules: "Thyroid nodules",
  cond_breast_cancer: "Breast cancer",
  cond_prostate_cancer: "Prostate cancer",
  cond_bowel_cancer: "Colorectal cancer",
  cond_lung_cancer: "Lung cancer",
};

function fmt(key, val) {
  if (val == null || (typeof val === "string" && val.trim() === "") || (Array.isArray(val) && val.length === 0)) return null;
  if (Array.isArray(val)) {
    const joined = val.filter(Boolean).join(", ");
    return joined.trim() ? joined : null;
  }
  const s = String(val).trim();
  return s || null;
}

function section(title, entries) {
  const lines = entries.filter(([, v]) => v != null && String(v).trim() !== "").map(([k, v]) => `${k}: ${v}`);
  if (lines.length === 0) return "";
  return `\n${title}\n${lines.join("\n")}\n`;
}

function pl(n, singular, plural) {
  const v = String(n).trim();
  return (v === "1" || parseInt(v, 10) === 1) ? singular : plural;
}

/** Ensures the string ends with exactly one period (avoids double periods from user input). */
function ensurePeriod(str) {
  if (str == null || typeof str !== "string") return str;
  const t = String(str).trim();
  return t === "" ? "" : (t.endsWith(".") ? t : t + ".");
}

const LBS_PER_KG = 2.20462;
const INCHES_PER_CM = 2.54;
const METERS_PER_INCH = 0.0254;

/** Get total height in inches from form data, or null if missing/invalid. */
function getTotalInches(data) {
  let totalInches = null;
  if (data.heightInCm === "yes" || data.heightInCm === true) {
    const cm = parseFloat(String(data.heightCm || "").trim(), 10);
    if (!Number.isNaN(cm) && cm > 0) totalInches = cm / INCHES_PER_CM;
  } else {
    const feet = parseInt(String(data.heightFeet || "").trim(), 10);
    const inches = parseFloat(String(data.heightInches || "").trim(), 10);
    if (!Number.isNaN(feet) && feet >= 0 && !Number.isNaN(inches) && inches >= 0) {
      totalInches = feet * 12 + inches;
    }
  }
  return totalInches != null && totalInches >= 0 ? totalInches : null;
}

/** Format height for email as "5'10" (178 cm)". Uses feet/inches or converts cm to inches. */
function formatHeightForEmail(data) {
  const totalInches = getTotalInches(data);
  if (totalInches == null) return null;
  const f = Math.floor(totalInches / 12);
  const i = Math.round(totalInches % 12);
  const totalCm = Math.round(totalInches * INCHES_PER_CM);
  return `${f}'${i}" (${totalCm} cm)`;
}

/** Get weight in kg from form data (weight value + weightUnit). Returns null if missing/invalid. */
function getWeightKg(data) {
  const w = parseFloat(String(data.weight || "").trim(), 10);
  if (Number.isNaN(w) || w <= 0) return null;
  const unit = (data.weightUnit || "lbs").toLowerCase();
  return unit === "kg" ? w : w / LBS_PER_KG;
}

/** Get weight in lbs from form data. Returns null if missing/invalid. */
function getWeightLbs(data) {
  const w = parseFloat(String(data.weight || "").trim(), 10);
  if (Number.isNaN(w) || w <= 0) return null;
  const unit = (data.weightUnit || "lbs").toLowerCase();
  return unit === "lbs" ? w : w * LBS_PER_KG;
}

/** Format weight for email as "x lbs (y kg)" with conversion. */
function formatWeightForEmail(data) {
  const lbs = getWeightLbs(data);
  const kg = getWeightKg(data);
  if (lbs == null || kg == null) return null;
  return `${Math.round(lbs)} lbs (${kg.toFixed(1)} kg)`;
}

/** Compute BMI from form data. Returns formatted string (e.g. "22.5") or null if height/weight missing. */
function getBMIForEmail(data) {
  const weightKg = getWeightKg(data);
  const totalInches = getTotalInches(data);
  if (weightKg == null || totalInches == null) return null;
  const heightM = totalInches * METERS_PER_INCH;
  if (heightM <= 0) return null;
  const bmi = weightKg / (heightM * heightM);
  return bmi.toFixed(1);
}

function buildEmailBody(data) {
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const val = (k) => fmt(k, data[k]);

  let body = "";

  body += section("CONTACT", [
    ["Full name", val("fullName")],
    ["Preferred name", val("preferredName")],
    ["Age", val("age")],
    ["Phone Home", val("phoneHome")],
    ["Phone Work", val("phoneWork")],
    ["Phone Cell", val("phoneCell")],
    ["Preferred number", arr(data.preferredNumber).length ? arr(data.preferredNumber).join(", ") : null],
    ["May we leave a message?", val("leaveMessage")],
    ["Email", val("email")],
    ["Emergency contact", val("emergencyContact")],
    ["Emergency relationship", val("emergencyRelation")],
    ["Emergency phone", val("emergencyPhone")],
  ]);

  body += section("MEDICAL TEAM", [
    ["Family doctor / NP", data.familyDoctorNone === "yes" ? "None" : val("familyDoctor")],
    ["Met Dr. Moore before", val("metDrMoore")],
    ["Main medical question", val("mainMedicalQuestion")],
    ["Other specialists", val("otherSpecialists")],
    ["Upcoming surgery", val("upcomingSurgery")],
    ["Preferred pharmacy", val("preferredPharmacy")],
  ]);

  const heightDisplay = formatHeightForEmail(data);
  const weightDisplay = formatWeightForEmail(data);
  const bmiDisplay = getBMIForEmail(data);
  body += section("HEIGHT / WEIGHT", [
    ["Height", heightDisplay],
    ["Weight", weightDisplay],
    ["BMI", bmiDisplay],
    ["Weight not sure", data.weightNotSure === "yes" ? "Yes" : null],
  ]);

  let conditions = Object.entries(CONDITION_LABELS)
    .filter(([k]) => data[k] === "yes" || data[k] === true)
    .map(([k, label]) => {
      if (k === "cond_diabetes") {
        const parts = [];
        if (data.diabetesType) parts.push(data.diabetesType);
        if (data.diabetesInsulin === "yes") parts.push("on insulin");
        if (data.diabetesAge) parts.push(`dx age ${data.diabetesAge}`);
        return parts.length ? `${label} (${parts.join(", ")})` : label;
      }
      if (k === "cond_sleep_apnea") {
        const parts = [];
        if (data.sleepApneaCpap === "yes") parts.push("on CPAP");
        if (data.sleepApneaNoTolerate === "yes") parts.push("didn't tolerate CPAP");
        return parts.length ? `${label} (${parts.join(", ")})` : label;
      }
      if (k === "cond_hep_c") {
        return data.hepCTreated === "yes" ? `${label} (treated)` : `${label} (untreated)`;
      }
      if (k === "cond_menopausal" && data.menopausalAge) {
        return `${label} (age ${data.menopausalAge})`;
      }
      return label;
    });
  const otherHeart = (data.cond_heart_other || "").toString().trim();
  const otherGI = (data.cond_gi_other || "").toString().trim();
  const otherCancer = (data.cond_cancer_other || "").toString().trim();
  if (otherHeart) conditions.push(otherHeart);
  if (otherGI) conditions.push(otherGI);
  if (otherCancer) conditions.push(otherCancer);

  const otherCondIndices = [...new Set(
    Object.keys(data)
      .filter((k) => /^other_condition_\d+_details$/.test(k))
      .map((k) => parseInt(k.match(/\d+/)[0], 10))
  )].sort((a, b) => a - b);
  const otherCondEntries = otherCondIndices
    .map((i) => (data[`other_condition_${i}_details`] || "").toString().trim())
    .filter((v) => v);

  const surgeryIndices = [...new Set(
    Object.keys(data)
      .filter((k) => /^surgery_\d+_details$/.test(k))
      .map((k) => parseInt(k.match(/\d+/)[0], 10))
  )].sort((a, b) => a - b);
  const surgeryEntries = surgeryIndices
    .map((i) => {
      const details = (data[`surgery_${i}_details`] || "").toString().trim();
      const year = (data[`surgery_${i}_year`] || "").toString().trim();
      return details ? (year ? `${details} (${year})` : details) : year || null;
    })
    .filter(Boolean);

  const pmhItems = [...conditions, ...otherCondEntries, ...surgeryEntries];
  if (pmhItems.length) {
    body += "\n\nPAST MEDICAL HISTORY:\n" + pmhItems.map((item) => ensurePeriod(item)).join("\n") + "\n";
  }

  const socialLines = [];
  const res = (data.residence || "").toString().trim();
  const withWho = (data.livesWith || "").toString().trim();
  if (res) {
    socialLines.push(ensurePeriod(withWho ? `Lives in ${res.toLowerCase() || "—"} with ${withWho.toLowerCase()}` : `Lives in ${res.toLowerCase()}`));
  } else if (withWho) {
    socialLines.push(ensurePeriod(`Lives with ${withWho.toLowerCase()}`));
  }
  const maritalArr = arr(data.maritalStatus);
  const marital = maritalArr.length ? maritalArr.join(", ") : null;
  if (marital) socialLines.push(ensurePeriod(marital));
  let edu = (data.education || "").toString().trim();
  if (data.student === "yes") edu = edu ? `${edu} (student)` : "Student";
  if (data.readingDifficulties === "yes") edu = edu ? `${edu} (reading difficulties)` : "Reading difficulties";
  if (edu) socialLines.push(`Education: ${ensurePeriod(edu)}`);
  const occ = (data.occupation || "").toString().trim();
  if (occ) {
    const status = val("occupationStatus");
    socialLines.push(ensurePeriod(status ? `${occ} (${status})` : occ));
  }
  const rxIns = val("rxInsurance");
  const rxPlan = val("rxInsurancePlan");
  if (rxIns) {
    socialLines.push(ensurePeriod(rxIns === "Private" && rxPlan ? `Prescription insurance: ${rxIns} (${rxPlan})` : `Prescription insurance: ${rxIns}`));
  } else if (rxPlan) {
    socialLines.push(ensurePeriod(`Prescription insurance: ${rxPlan}`));
  }
  const tobacco = val("tobacco");
  if (tobacco && tobacco !== "Never smoked") {
    if (tobacco === "Former") {
      const year = val("quitDate");
      const packs = val("packsPerDay");
      const years = val("yearsSmoked");
      const parts = [year, packs, years].filter(Boolean);
      const packWord = pl(packs, "pack", "packs");
      const yearWord = pl(years, "year", "years");
      const nic = parts.length >= 3
        ? `Former smoker: quit ${year} after ${packs} ${packWord} a day for ${years} ${yearWord}`
        : parts.length ? `Former smoker: quit ${parts.join(", ")}` : "Former smoker";
      socialLines.push(ensurePeriod(nic));
    } else if (tobacco === "Current") {
      let types = arr(data.smokeType);
      if (!Array.isArray(types) || types.some((t) => typeof t !== "string")) {
        types = [];
      }
      if (types.length === 1 && typeof types[0] === "string" && types[0].includes(",")) {
        types = types[0].split(",").map((s) => s.trim()).filter(Boolean);
      }
      const has = (v) => types.some((t) => String(t).toLowerCase() === v.toLowerCase());
      const quitInterest = val("quitInterest");
      const quitSuffix = quitInterest === "Interested" ? " (interested in quitting)" : quitInterest ? " (not ready to quit at this time)" : "";
      let first = true;
      if (has("Cigarettes")) {
        const packs = val("currentCigarettePacks") || val("currentPacksPerDay");
        const years = val("currentCigaretteYears") || val("currentYears");
        const packWord = pl(packs, "pack", "packs");
        const yearWord = pl(years, "year", "years");
        const detail = packs && years ? `${packs} ${packWord} a day for ${years} ${yearWord}` : (packs || years) ? [packs, years].filter(Boolean).join(", ") : "—";
        socialLines.push(ensurePeriod(`Uses cigarettes: ${detail}${first ? quitSuffix : ""}`));
        first = false;
      }
      if (has("Chewing tobacco")) {
        const packs = val("currentChewingPacks") || val("currentPacksPerDay");
        const years = val("currentChewingYears") || val("currentYears");
        const packWord = pl(packs, "pack", "packs");
        const yearWord = pl(years, "year", "years");
        const detail = packs && years ? `${packs} ${packWord} a day for ${years} ${yearWord}` : (packs || years) ? [packs, years].filter(Boolean).join(", ") : "—";
        socialLines.push(ensurePeriod(`Uses chewing tobacco: ${detail}${first ? quitSuffix : ""}`));
        first = false;
      }
      if (has("Cigars")) {
        const cigars = val("currentCigarsPerDay");
        const years = val("currentCigarsYears") || val("currentYears");
        const yearWord = pl(years, "year", "years");
        const detail = cigars && years ? `${cigars} per day for ${years} ${yearWord}` : cigars || years ? [cigars, years].filter(Boolean).join(", ") : "—";
        socialLines.push(ensurePeriod(`Uses cigars: ${detail}${first ? quitSuffix : ""}`));
        first = false;
      }
      if (has("Vape")) {
        const mls = val("currentMlPerDay");
        const years = val("currentVapeYears") || val("currentYears");
        const yearWord = pl(years, "year", "years");
        const detail = mls && years ? `${mls} mls e-liquid per day for ${years} ${yearWord}` : mls || years ? [mls, years].filter(Boolean).join(", ") : "—";
        socialLines.push(ensurePeriod(`Uses vape: ${detail}${first ? quitSuffix : ""}`));
        first = false;
      }
      if (types.length === 0) {
        socialLines.push(ensurePeriod(`Uses nicotine${quitSuffix}`));
      } else if (first) {
        const smokeTypeStr = types.join(", ");
        const packs = val("currentCigarettePacks") || val("currentPacksPerDay");
        const years = val("currentYears");
        const detail = packs && years ? `${packs} pack(s) a day for ${years} year(s)` : packs || years ? [packs, years].filter(Boolean).join(", ") : null;
        socialLines.push(ensurePeriod(detail ? `Uses ${smokeTypeStr}: ${detail}${quitSuffix}` : `Uses ${smokeTypeStr}${quitSuffix}`));
      }
    } else {
      socialLines.push(ensurePeriod(`Nicotine use: ${tobacco}`));
    }
  }
  const alcohol = val("alcohol");
  if (alcohol && alcohol !== "None") {
    const drinks = val("alcoholDrinks");
    const per = val("alcoholPer");
    const period = per === "day" ? "day" : "week";
    const drinkWord = pl(drinks, "drink", "drinks");
    const alc = drinks
      ? `${drinks} alcoholic ${drinkWord} per ${period}${alcohol === "Struggle" ? " (struggling)" : ""}`
      : `Alcohol use: ${alcohol}${alcohol === "Struggle" ? " (struggling)" : ""}`;
    socialLines.push(ensurePeriod(alc));
  }
  const marijuana = val("marijuana");
  if (marijuana && marijuana !== "None") {
    const adv = marijuana === "Medical" ? "medicinally" : "recreationally";
    const freq = (data.marijuanaFreq || "").toString().trim();
    const freqStr = freq ? ` (${freq.toLowerCase()})` : "";
    socialLines.push(`Uses marijuana ${adv}${freqStr}.`);
  }
  const otherDrugs = val("otherDrugs");
  if (otherDrugs && otherDrugs !== "No") {
    const types = arr(data.otherDrugsType).filter(Boolean);
    const other = (data.otherDrugsOther || "").toString().trim();
    const drugList = types.length
      ? types.map((t) => (t === "Other" ? other : t)).filter(Boolean).join(", ") || other
      : other;
    socialLines.push(ensurePeriod(drugList ? `Uses ${drugList.toLowerCase()}` : "Uses other drugs"));
  }
  const caffeine = (data.caffeinePerDay || "").toString().trim();
  if (caffeine) {
    const drinkWord = pl(caffeine, "caffeinated drink", "caffeinated drinks");
    socialLines.push(ensurePeriod(`${caffeine} ${drinkWord} per day`));
  }
  const exercise = val("exercise");
  if (exercise === "Not much") {
    socialLines.push("Does not exercise.");
  } else if (exercise === "Yes") {
    const exDetails = (data.exerciseDetails || "").toString().trim();
    socialLines.push(exDetails ? `Exercise: ${ensurePeriod(exDetails)}` : "Exercises.");
  } else if (exercise) {
    socialLines.push(ensurePeriod(`Exercise: ${exercise}`));
  }

  const hobbies = (data.hobbies || "").toString().trim();
  if (hobbies) socialLines.push(`Hobbies: ${ensurePeriod(hobbies)}`);
  if (socialLines.length) {
    body += "\nSOCIAL HISTORY:\n" + socialLines.join("\n") + "\n";
  }

  const allergyIndices = [...new Set(
    Object.keys(data)
      .filter((k) => /^allergy_\d+_allergen$/.test(k))
      .map((k) => parseInt(k.match(/\d+/)[0], 10))
  )].sort((a, b) => a - b);
  const allergyEntries = allergyIndices
    .map((i) => ({
      allergen: (data[`allergy_${i}_allergen`] || "").toString().trim(),
      reaction: (data[`allergy_${i}_reaction`] || "").toString().trim(),
    }))
    .filter((row) => row.allergen || row.reaction);
  if (data.noAllergies === "yes") {
    body += "\n\nALLERGIES:\nNo Adverse Reactions known\n";
  } else if (allergyEntries.length) {
    body += "\n\nALLERGIES:\n" + allergyEntries.map((row) => `${row.allergen || "—"} - ${row.reaction || "—"}`).join("\n") + "\n";
  }

  const famIndices = [...new Set(
    Object.keys(data)
      .filter((k) => /^family_\d+_relation$/.test(k))
      .map((k) => parseInt(k.match(/\d+/)[0], 10))
  )].sort((a, b) => a - b);
  const famLines = famIndices
    .map((i) => ({
      rel: (data[`family_${i}_relation`] || "").toString().trim(),
      status: (data[`family_${i}_status`] || "").toString().trim(),
      age: (data[`family_${i}_age`] || "").toString().trim(),
      cond: (data[`family_${i}_conditions`] || "").toString().trim(),
    }))
    .filter((row) => row.rel && (row.status || row.age || row.cond))
    .map((row) => {
      if (!row.status) {
        if (row.age && row.cond) return `${row.rel}, ${row.age}: ${row.cond}`;
        if (row.age) return `${row.rel}, ${row.age}`;
        return `${row.rel}, ${row.cond}`;
      }
      const s = row.status.toLowerCase();
      const statusPhrase = s.includes("passed") || s.includes("died") ? "died at" : "living at";
      const agePart = row.age ? `${statusPhrase} ${row.age}` : row.status;
      const tail = row.cond ? `: ${row.cond}` : "";
      return `${row.rel}, ${agePart}${tail}`;
    });
  if (famLines.length || data.adopted === "yes") {
    body += "\n\nFAMILY HISTORY:\n";
    if (data.adopted === "yes") body += "Adopted (biological relatives only).\n";
    body += famLines.join("\n") + (famLines.length ? "\n" : "");
  }

  return body.trim();
}

function sanitizeDriveFilenamePart(str) {
  const t = String(str || "Patient").trim() || "Patient";
  return t.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").slice(0, 80).replace(/\s/g, "_");
}

function intakeDriveBaseFilename(data) {
  const display = (data.fullName || data.preferredName || "Patient").trim() || "Patient";
  const age = data.age ? data.age.toString().trim() + "_" : "";
  const isoDate = new Date().toISOString().slice(0, 10);
  return `${sanitizeDriveFilenamePart(display)}_${age}${isoDate}`;
}

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

/** Must match an “Authorized redirect URI” in Google Cloud Console for this OAuth client. */
function oauthRedirectUri() {
  const fromEnv = (process.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim();
  if (fromEnv) return fromEnv;
  return `http://localhost:${process.env.PORT || 3000}/api/google/oauth2callback`;
}

/** Express may stringify duplicate query keys as arrays. */
function normalizeOAuthQueryParam(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return normalizeOAuthQueryParam(v[0]);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function oauthCallbackHtmlEscaped(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getDriveOAuthClientIdAndSecret() {
  const clientId = (process.env.GOOGLE_DRIVE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_DRIVE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** OAuth user flow (My Drive / shared folders you own). */
function createOAuth2Client() {
  const pair = getDriveOAuthClientIdAndSecret();
  if (!pair) return null;
  return new google.auth.OAuth2(pair.clientId, pair.clientSecret, oauthRedirectUri());
}

function isOAuthDriveReady() {
  const refreshToken = (process.env.GOOGLE_OAUTH_REFRESH_TOKEN || "").trim();
  return !!(getDriveOAuthClientIdAndSecret() && refreshToken);
}

/** OAuth-only: user refresh token backs uploads to Drive. */
function createDriveClientForUpload() {
  if (!isOAuthDriveReady()) return null;
  const oauth2 = createOAuth2Client();
  oauth2.setCredentials({ refresh_token: (process.env.GOOGLE_OAUTH_REFRESH_TOKEN || "").trim() });
  return google.drive({ version: "v3", auth: oauth2 });
}

function isDriveUploadConfigured() {
  return isOAuthDriveReady();
}

async function uploadBufferToDrive(drive, folderId, filename, buffer, mimeType) {
  const requestBody = { name: filename };
  const trimmed = folderId ? String(folderId).trim() : "";
  if (trimmed) requestBody.parents = [trimmed];
  await drive.files.create({
    requestBody,
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id",
    supportsAllDrives: true,
  });
}

/** PDF with explicit line layout — Drive print opens in Acrobat; auto-converted .txt PDFs often drop newlines. */
function intakeTextToPdfBuffer(text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Courier").fontSize(9);
    const normalized = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    for (const line of normalized.split("\n")) {
      doc.text(line.length ? line : " ", { width: pageWidth, lineGap: 1 });
    }
    doc.end();
  });
}

async function archiveIntakeToDrive(data, emailBodyText, jpegBuffer) {
  const drive = createDriveClientForUpload();
  if (!drive) return;
  const folderIdRaw = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const folderId = folderIdRaw != null ? String(folderIdRaw).trim() : "";
  const base = intakeDriveBaseFilename(data);
  const pdfBuf = await intakeTextToPdfBuffer(emailBodyText);
  await uploadBufferToDrive(drive, folderId, `${base}.pdf`, pdfBuf, "application/pdf");
  if (jpegBuffer && jpegBuffer.length > 0) {
    await uploadBufferToDrive(drive, folderId, `${base}-photo.jpg`, jpegBuffer, "image/jpeg");
  }
}

function driveOAuthSetupAllowed() {
  const v = (process.env.ALLOW_DRIVE_OAUTH_SETUP || "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}

app.get("/api/google/start-auth", (req, res) => {
  if (!driveOAuthSetupAllowed()) {
    return res.status(404).send("Not found.");
  }
  const oauth2 = createOAuth2Client();
  if (!oauth2) {
    return res
      .status(503)
      .type("text")
      .send("Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in .env, then restart the server.");
  }
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: DRIVE_SCOPES,
  });
  res.redirect(url);
});

app.get("/api/google/oauth2callback", async (req, res) => {
  if (!driveOAuthSetupAllowed()) {
    return res.status(404).send("Not found.");
  }
  const oauthErr = normalizeOAuthQueryParam(req.query.error);
  const oauthErrDesc = normalizeOAuthQueryParam(req.query.error_description);
  let descPlain = oauthErrDesc;
  if (descPlain) {
    try {
      descPlain = decodeURIComponent(descPlain.replace(/\+/g, " "));
    } catch {
      /* keep raw */
    }
  }
  if (oauthErr) {
    const detail = descPlain ? `<p>${oauthCallbackHtmlEscaped(descPlain)}</p>` : "";
    return res.status(400).type("html").send(
      `<!DOCTYPE html><meta charset="utf-8"><title>OAuth error</title><body><p>Google reported: <strong>${oauthCallbackHtmlEscaped(oauthErr)}</strong>.</p>${detail}<p>For <code>redirect_uri_mismatch</code>, the redirect URI configured in Google Cloud Console must exactly match your server’s <code>GOOGLE_OAUTH_REDIRECT_URI</code> (or default localhost URL). Restart after changing env.</p></body></html>`
    );
  }

  const code = normalizeOAuthQueryParam(req.query.code);
  if (!code) {
    const expected = oauthRedirectUri();
    const keys = req.query && typeof req.query === "object" ? Object.keys(req.query).join(", ") : "";
    console.warn(
      `[OAuth callback] No ?code=. originalUrl=${req.originalUrl}; queryKeys=${keys || "(none)"}; redirectInUse=${expected}`
    );
    return res.status(400).type("html").send(
      `<!DOCTYPE html><meta charset="utf-8"><title>OAuth callback</title><body><p>Missing authorization <code>?code</code> from Google. That usually means:</p><ul>` +
        `<li>You opened this callback URL directly (bookmark). Start from <a href="/api/google/start-auth">/api/google/start-auth</a> on <strong>this same host</strong> instead.</li>` +
        `<li>You started sign-in locally but production (or vice versa): set <code>GOOGLE_OAUTH_REDIRECT_URI</code> on the server to exactly one registered URI—for example <code>${oauthCallbackHtmlEscaped(expected)}</code>.</li>` +
        `<li>A reverse proxy or host stripped the URL query string (check CDN / nginx / rewrite rules).</li></ul>` +
        `<p>Server expects redirect URI: <code>${oauthCallbackHtmlEscaped(expected)}</code></p></body></html>`
    );
  }

  const oauth2 = createOAuth2Client();
  if (!oauth2) {
    return res.status(503).type("text").send("OAuth client not configured.");
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      return res
        .status(200)
        .type("html")
        .send(
          "<!DOCTYPE html><html><body><p>Google did not return a refresh token. In your Google Account, remove this app’s access under “Third-party access”, then visit <code>/api/google/start-auth</code> again.</p></body></html>"
        );
    }
    console.log("\n========================================");
    console.log("GOOGLE DRIVE OAuth — add to .env:\nGOOGLE_OAUTH_REFRESH_TOKEN=%s", tokens.refresh_token);
    console.log("========================================\n");
    res
      .status(200)
      .type("html")
      .send(
        "<!DOCTYPE html><html><body><p>Success. Check the <strong>server terminal</strong> for <code>GOOGLE_OAUTH_REFRESH_TOKEN</code>, add it to <code>.env</code>, then restart.</p></body></html>"
      );
  } catch (e) {
    console.error("OAuth token exchange:", e);
    res.status(500).type("text").send("Token exchange failed. See server log.");
  }
});

app.post("/api/submit", upload.fields([{ name: "data" }, { name: "photo", maxCount: 1 }]), async (req, res) => {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const officeEmail = process.env.OFFICE_EMAIL;
  const fromEmail = process.env.FROM_EMAIL;
  const fromName = process.env.FROM_NAME || "Office Form";

  if (!apiKey || !domain || !officeEmail || !fromEmail) {
    console.error("Missing env: MAILGUN_API_KEY, MAILGUN_DOMAIN, OFFICE_EMAIL, or FROM_EMAIL");
    return res.status(500).json({
      success: false,
      message: "Server is not configured for email. Please contact the administrator.",
    });
  }

  let formDataParsed = {};
  try {
    if (req.body?.data) {
      formDataParsed = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body.data;
    } else if (req.body && typeof req.body === "object" && "fullName" in req.body) {
      formDataParsed = req.body;
    }
  } catch {
    return res.status(400).json({ success: false, message: "Invalid form data." });
  }

  const emailBody = buildEmailBody(formDataParsed);
  const displayName = formDataParsed.preferredName || formDataParsed.fullName || "Unknown";
  const subject = `New Patient Form: ${displayName} - ${new Date().toLocaleDateString()}`;

  const opts = {
    from: `${fromName} <${fromEmail}>`,
    to: [officeEmail],
    subject,
    text: emailBody,
    html: `<pre style="font-family:sans-serif;white-space:pre-wrap;">${emailBody.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
    "o:require-tls": true,
  };

  let compressedPhotoBuffer = null;
  const photoFile = req.files?.photo?.[0];
  if (photoFile && photoFile.buffer) {
    try {
      compressedPhotoBuffer = await sharp(photoFile.buffer)
        .resize(800, 800, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      opts.attachment = [{ filename: "patient-photo.jpg", data: compressedPhotoBuffer }];
    } catch (err) {
      console.error("Image compress error:", err);
    }
  }

  const driveUploadConfigured = isDriveUploadConfigured();
  let driveArchived = false;
  if (driveUploadConfigured) {
    try {
      await archiveIntakeToDrive(formDataParsed, emailBody, compressedPhotoBuffer);
      driveArchived = true;
    } catch (driveErr) {
      console.error("Google Drive upload error:", driveErr);
    }
  }

  try {
    await mg.messages.create(domain, opts);
    const payload = { success: true, message: "Form submitted successfully." };
    if (driveUploadConfigured) payload.driveArchived = driveArchived;
    return res.json(payload);
  } catch (err) {
    console.error("Mailgun error:", err);
    const payload = {
      success: false,
      message: "Failed to send form. Please try again or contact the office.",
    };
    if (driveUploadConfigured) payload.driveArchived = driveArchived;
    return res.status(500).json(payload);
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (driveOAuthSetupAllowed() && createOAuth2Client()) {
    console.log(`OAuth redirect URI in use — must match Google Cloud “Authorized redirect URIs”: ${oauthRedirectUri()}`);
  }
});
