/**
 * Clinical data management acronyms.
 *
 * Two jobs, deliberately split: the eye gets a short, colour-coded badge it can
 * recognise at speed, while the ear gets the expansion spoken in full. Reading
 * "eCRF" as four letters teaches nothing; hearing "electronic case report form"
 * every time is what builds the association.
 */

export type AcronymCategory =
  | "standard"
  | "regulatory"
  | "operational"
  | "safety"
  | "data";

export interface Acronym {
  /** Spoken expansion, lowercase — it is read inside a sentence. */
  expansion: string;
  category: AcronymCategory;
}

export const ACRONYMS: Record<string, Acronym> = {
  // Data standards
  CDISC: { expansion: "the Clinical Data Interchange Standards Consortium", category: "standard" },
  CDASH: { expansion: "the Clinical Data Acquisition Standards Harmonization standard", category: "standard" },
  SDTM: { expansion: "the Study Data Tabulation Model", category: "standard" },
  ADaM: { expansion: "the Analysis Data Model", category: "standard" },
  ODM: { expansion: "the Operational Data Model", category: "standard" },
  MedDRA: { expansion: "the Medical Dictionary for Regulatory Activities", category: "standard" },
  WHODrug: { expansion: "the World Health Organization drug dictionary", category: "standard" },
  LOINC: { expansion: "Logical Observation Identifiers Names and Codes", category: "standard" },

  // Systems and data capture
  EDC: { expansion: "electronic data capture", category: "data" },
  CRF: { expansion: "case report form", category: "data" },
  eCRF: { expansion: "electronic case report form", category: "data" },
  eSource: { expansion: "electronic source data", category: "data" },
  EHR: { expansion: "electronic health record", category: "data" },
  ePRO: { expansion: "electronic patient reported outcome", category: "data" },
  PRO: { expansion: "patient reported outcome", category: "data" },
  COA: { expansion: "clinical outcome assessment", category: "data" },
  CTMS: { expansion: "clinical trial management system", category: "data" },
  IVRS: { expansion: "interactive voice response system", category: "data" },
  IWRS: { expansion: "interactive web response system", category: "data" },
  RTSM: { expansion: "randomization and trial supply management", category: "data" },
  eTMF: { expansion: "electronic trial master file", category: "data" },
  TMF: { expansion: "trial master file", category: "data" },
  OCR: { expansion: "optical character recognition", category: "data" },
  API: { expansion: "application programming interface", category: "data" },

  // Regulatory
  GCP: { expansion: "Good Clinical Practice", category: "regulatory" },
  ICH: { expansion: "the International Council for Harmonisation", category: "regulatory" },
  FDA: { expansion: "the Food and Drug Administration", category: "regulatory" },
  EMA: { expansion: "the European Medicines Agency", category: "regulatory" },
  IRB: { expansion: "the institutional review board", category: "regulatory" },
  IND: { expansion: "investigational new drug application", category: "regulatory" },
  NDA: { expansion: "new drug application", category: "regulatory" },
  BLA: { expansion: "biologics license application", category: "regulatory" },
  HIPAA: { expansion: "the Health Insurance Portability and Accountability Act", category: "regulatory" },
  GDPR: { expansion: "the General Data Protection Regulation", category: "regulatory" },
  PHI: { expansion: "protected health information", category: "regulatory" },
  PII: { expansion: "personally identifiable information", category: "regulatory" },
  CFR: { expansion: "the Code of Federal Regulations", category: "regulatory" },

  // Operational
  CRO: { expansion: "contract research organization", category: "operational" },
  SOP: { expansion: "standard operating procedure", category: "operational" },
  DMP: { expansion: "data management plan", category: "operational" },
  SAP: { expansion: "statistical analysis plan", category: "operational" },
  CSR: { expansion: "clinical study report", category: "operational" },
  UAT: { expansion: "user acceptance testing", category: "operational" },
  QC: { expansion: "quality control", category: "operational" },
  QA: { expansion: "quality assurance", category: "operational" },
  CRA: { expansion: "clinical research associate", category: "operational" },
  CDM: { expansion: "clinical data management", category: "operational" },
  GCDMP: { expansion: "the Good Clinical Data Management Practices guidance", category: "operational" },
  SCDM: { expansion: "the Society for Clinical Data Management", category: "operational" },
  CCDA: { expansion: "the Certified Clinical Data Associate credential", category: "operational" },
  PI: { expansion: "principal investigator", category: "operational" },

  // Safety
  AE: { expansion: "adverse event", category: "safety" },
  SAE: { expansion: "serious adverse event", category: "safety" },
  SUSAR: { expansion: "suspected unexpected serious adverse reaction", category: "safety" },
  DSMB: { expansion: "data safety monitoring board", category: "safety" },
  IDMC: { expansion: "independent data monitoring committee", category: "safety" },
};

/**
 * Longest key first. Nothing here scans prefixes any more, but the order still
 * decides which key claims a plural form if two ever produce the same one.
 */
const KEYS = Object.keys(ACRONYMS).sort((a, b) => b.length - a.length);

/**
 * Every key, and every plural or possessive form of one, as a single lookup.
 *
 * This was a linear scan: 56 keys per token, with three template literals
 * allocated per key to test the plural forms. Over the full GCDMP's 136,645
 * tokens that is 7.6 million comparisons and 23 million throwaway strings, and
 * it measured at 10% of the entire document-open profile in the browser.
 *
 * Exactness is what makes the swap safe rather than merely faster. The scan
 * returned on the first key matching *either* exactly or as a variant, so the
 * order only matters if some token could exact-match one key and variant-match
 * another. A variant is its key plus a suffix, so a variant match implies the
 * key is shorter than the token while an exact match implies it is the same
 * length: no token can do both. Exact first, then variants, is the same
 * function. `acronyms.test.ts` holds the old scan and asserts they agree.
 */
const EXACT = new Set(KEYS);
const VARIANTS = new Map<string, string>();
for (const key of KEYS) {
  for (const variant of [key + "s", key + "'s", key + "’s"]) {
    if (!VARIANTS.has(variant)) VARIANTS.set(variant, key);
  }
}

/**
 * Every key carries at least one capital, so a token with none cannot match and
 * does not need the shell regex run over it. Most of a document is that case,
 * and the regex is the remaining cost once the scan is gone. Safe because the
 * characters the shell strips are non-alphanumeric by construction, so the
 * token has a capital exactly when its core does.
 */
const HAS_CAPITAL = /[A-Z]/;
const SHELL = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/;

export interface AcronymMatch {
  key: string;
  /** Punctuation before the acronym, preserved for display and speech. */
  lead: string;
  /** Punctuation after it, likewise. */
  trail: string;
  acronym: Acronym;
}

/**
 * Match a whole token against the dictionary, tolerating surrounding
 * punctuation and a plural or possessive suffix ("CRFs", "CRF's").
 *
 * Matching is case-sensitive by design: `AE` is an adverse event, `ae` is a
 * typo or a fragment, and lowercasing would badge ordinary words like "pi".
 */
export function matchAcronym(token: string): AcronymMatch | null {
  if (!HAS_CAPITAL.test(token)) return null;

  const shell = SHELL.exec(token);
  if (!shell) return null;

  const [, lead, core, trail] = shell;
  if (!core) return null;

  const key = EXACT.has(core) ? core : VARIANTS.get(core);
  if (key === undefined) return null;

  return { key, lead, trail, acronym: ACRONYMS[key] };
}

/** The string handed to the synthesizer for a token: expanded if recognised. */
export function spokenForm(token: string): string {
  const match = matchAcronym(token);
  if (!match) return token;

  const core = match.acronym.expansion;
  const plural = /s['’]?[^A-Za-z0-9]*$/.test(token) && !core.endsWith("s");
  return `${match.lead}${plural ? `${core}s` : core}${match.trail}`;
}
