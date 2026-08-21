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

/** Longest key first, so "eCRF" is preferred over "CRF" on a prefix scan. */
const KEYS = Object.keys(ACRONYMS).sort((a, b) => b.length - a.length);

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
  const shell = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/.exec(token);
  if (!shell) return null;

  const [, lead, core, trail] = shell;
  if (!core) return null;

  for (const key of KEYS) {
    if (core === key) {
      return { key, lead, trail, acronym: ACRONYMS[key] };
    }
    // Plural or possessive: "eCRFs", "CRF's".
    if (core === `${key}s` || core === `${key}'s` || core === `${key}’s`) {
      return { key, lead, trail, acronym: ACRONYMS[key] };
    }
  }

  return null;
}

/** The string handed to the synthesizer for a token: expanded if recognised. */
export function spokenForm(token: string): string {
  const match = matchAcronym(token);
  if (!match) return token;

  const core = match.acronym.expansion;
  const plural = /s['’]?[^A-Za-z0-9]*$/.test(token) && !core.endsWith("s");
  return `${match.lead}${plural ? `${core}s` : core}${match.trail}`;
}
