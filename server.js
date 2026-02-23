require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const formData = require("form-data");
const Mailgun = require("mailgun.js");

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

const CONDITION_LABELS = {
  cond_high_bp: "Hypertension",
  cond_cholesterol: "Cholesterol problems",
  cond_diabetes: "Diabetes",
  cond_erectile_dysfunction: "Erectile dysfunction",
  cond_menopausal: "Post-menopausal",
  cond_stroke: "Stroke",
  cond_sleep_apnea: "Sleep apnea",
  cond_kidney_disease: "Kidney disease",
  cond_heart_attack: "Myocardial infarction",
  cond_angina: "Angina",
  cond_angioplasty: "Coronary angioplasty",
  cond_cabg: "CABG",
  cond_valve_surgery: "Valve surgery",
  cond_defib: "ICD",
  cond_pacemaker: "Permanent pacemaker",
  cond_atrial_fib: "Atrial fibrillation",
  cond_heart_failure: "Heart failure",
  cond_asthma: "Asthma",
  cond_copd: "COPD",
  cond_emphysema: "Emphysema",
  cond_pulmonary_embolism: "Pulmonary embolism",
  cond_heart_burn: "Gastroesophageal reflux",
  cond_ibs: "IBS",
  cond_ulcerative_colitis: "Ulcerative colitis",
  cond_crohns: "Crohn's disease",
  cond_celiac: "Celiac disease",
  cond_fatty_liver: "Fatty liver",
  cond_cirrhosis: "Cirrhosis",
  cond_hep_c: "Hepatitis C",
  cond_anxiety: "Anxiety",
  cond_depression: "Depression",
  cond_panic_attacks: "Panic attacks",
  cond_ptsd: "PTSD",
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

  body += section("HEIGHT / WEIGHT / HOBBIES", [
    ["Height", val("height")],
    ["Weight", val("weight")],
    ["Weight not sure", data.weightNotSure === "yes" ? "Yes" : null],
    ["Hobbies", val("hobbies")],
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
    body += "\n\nPAST MEDICAL HISTORY:\n" + pmhItems.map((item) => `${item}.`).join("\n") + "\n";
  }

  const socialLines = [];
  const occ = (data.occupation || "").toString().trim();
  if (occ) {
    const status = val("occupationStatus");
    socialLines.push(status ? `${occ} (${status}).` : `${occ}.`);
  }
  const res = (data.residence || "").toString().trim();
  const withWho = (data.livesWith || "").toString().trim();
  if (res || withWho) {
    socialLines.push(withWho ? `Lives in ${res.toLowerCase() || "—"} with ${withWho}.` : `Lives in ${res.toLowerCase()}.`);
  }
  const marital = val("maritalStatus");
  if (marital) socialLines.push(marital === "Partner" ? "Has a partner." : `${marital}.`);
  let edu = (data.education || "").toString().trim();
  if (data.student === "yes") edu = edu ? `${edu} (student)` : "Student";
  if (data.readingDifficulties === "yes") edu = edu ? `${edu} (reading difficulties)` : "Reading difficulties";
  if (edu) socialLines.push(`Education: ${edu}.`);
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
        ? `Former smoker: quit ${year} after ${packs} ${packWord} a day for ${years} ${yearWord}.`
        : parts.length ? `Former smoker: quit ${parts.join(", ")}.` : "Former smoker.";
      socialLines.push(nic);
    } else if (tobacco === "Current") {
      const smokeType = arr(data.smokeType).join(", ") || "nicotine";
      const packs = val("currentPacksPerDay");
      const years = val("currentYears");
      const packWord = pl(packs, "pack", "packs");
      const yearWord = pl(years, "year", "years");
      const nic = packs && years
        ? `Uses ${smokeType}: ${packs} ${packWord} a day for ${years} ${yearWord}.`
        : packs || years ? `Uses ${smokeType}: ${[packs, years].filter(Boolean).join(", ")}.` : `Uses ${smokeType}.`;
      socialLines.push(nic);
    } else {
      socialLines.push(`Nicotine use: ${tobacco}.`);
    }
  }
  const alcohol = val("alcohol");
  if (alcohol && alcohol !== "None") {
    const drinks = val("alcoholDrinks");
    const per = val("alcoholPer");
    const period = per === "day" ? "day" : "week";
    const drinkWord = pl(drinks, "drink", "drinks");
    const alc = drinks
      ? `${drinks} alcoholic ${drinkWord} per ${period}.${alcohol === "Struggle" ? " (struggling)" : ""}`
      : `Alcohol use: ${alcohol}.${alcohol === "Struggle" ? " (struggling)" : ""}`;
    socialLines.push(alc);
  }
  const marijuana = val("marijuana");
  if (marijuana && marijuana !== "None") {
    const adv = marijuana === "Medical" ? "medicinally" : "recreationally";
    socialLines.push(`Uses marijuana ${adv}.`);
  }
  const otherDrugs = val("otherDrugs");
  if (otherDrugs && otherDrugs !== "No") {
    const types = arr(data.otherDrugsType).filter(Boolean);
    const other = (data.otherDrugsOther || "").toString().trim();
    const drugList = types.length
      ? types.map((t) => (t === "Other" ? other : t)).filter(Boolean).join(", ") || other
      : other;
    socialLines.push(drugList ? `Uses ${drugList.toLowerCase()}.` : "Uses other drugs.");
  }
  const caffeine = (data.caffeinePerDay || "").toString().trim();
  if (caffeine) {
    const drinkWord = pl(caffeine, "caffeinated drink", "caffeinated drinks");
    socialLines.push(`${caffeine} ${drinkWord} per day.`);
  }
  const exercise = val("exercise");
  if (exercise === "Not much") {
    socialLines.push("Does not exercise.");
  } else if (exercise === "Yes") {
    const exDetails = (data.exerciseDetails || "").toString().trim();
    socialLines.push(exDetails ? `Exercise: ${exDetails}.` : "Exercises.");
  } else if (exercise) {
    socialLines.push(`Exercise: ${exercise}.`);
  }
  const rxIns = val("rxInsurance");
  const rxPlan = val("rxInsurancePlan");
  if (rxIns) {
    socialLines.push(rxIns === "Private" && rxPlan ? `Prescription insurance: ${rxIns} (${rxPlan}).` : `Prescription insurance: ${rxIns}.`);
  } else if (rxPlan) {
    socialLines.push(`Prescription insurance: ${rxPlan}.`);
  }
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
    .filter((row) => row.rel || row.status || row.age || row.cond)
    .map((row) => {
      const s = (row.status || "").toLowerCase();
      const statusPhrase = s.includes("passed") || s.includes("died") ? "died at" : "living at";
      const agePart = row.age ? `${statusPhrase} ${row.age}` : row.status || "—";
      return `${row.rel || "—"}, ${agePart}: ${row.cond || ""}`;
    });
  if (famLines.length || data.adopted === "yes") {
    body += "\n\nFAMILY HISTORY:\n";
    if (data.adopted === "yes") body += "Adopted (biological relatives only).\n";
    body += famLines.join("\n") + (famLines.length ? "\n" : "");
  }

  return body.trim();
}

app.post("/api/submit", async (req, res) => {
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

  const formData = req.body || {};
  const emailBody = buildEmailBody(formData);
  const displayName = formData.preferredName || formData.fullName || "Unknown";
  const subject = `New Patient Form: ${displayName} - ${new Date().toLocaleDateString()}`;

  try {
    await mg.messages.create(domain, {
      from: `${fromName} <${fromEmail}>`,
      to: [officeEmail],
      subject,
      text: emailBody,
      html: `<pre style="font-family:sans-serif;white-space:pre-wrap;">${emailBody.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
    });

    return res.json({ success: true, message: "Form submitted successfully." });
  } catch (err) {
    console.error("Mailgun error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send form. Please try again or contact the office.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
