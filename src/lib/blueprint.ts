/**
 * What the exam covers — as opposed to what the reader happens to own.
 *
 * Every other account in this app measures the corpus against itself.
 * `coverage.ts` answers "how much of this document have I verified"; the corpus
 * index answers "where else does this term appear". Both are closed systems:
 * they can only report on material already in the library, so the one question
 * they structurally cannot answer is the one that decides the exam — **what is
 * on the blueprint that I do not have?**
 *
 * That gap is invisible from inside the app and it is not closed by reading
 * harder. It is closed by comparing the library against an external list.
 *
 * ## Why this is transcribed rather than parsed
 *
 * `SCDM_CCDA_ExamStudyGuide.pdf` states the blueprint, and it would be natural
 * to feed it through `pdf.ts` like everything else. That is the wrong call
 * here. The domain tables in that PDF are rotated — the task column runs
 * diagonally across the page — and extraction interleaves the chapter names
 * with fragments of task text and page furniture. A heuristic over that
 * produces a *plausible* blueprint, and a domain missing two chapters reads
 * exactly like a domain that only has four. A wrong blueprint is worse than no
 * blueprint, because it reports coverage the reader does not have.
 *
 * So the blueprint is transcribed from the published guide and checked by
 * `scripts/scan-blueprint.mjs` against the corpus. It is data that changes when
 * SCDM republishes the guide, which is roughly never. Every name below is
 * spelled as the guide spells it, including the guide's own inconsistencies —
 * which is what `ALIASES` exists to absorb.
 *
 * Source: SCDM CCDA Exam Study Guide, section 1 (domains and tasks) and
 * section 2 (GCDMP chapters with minimum standards and best practices).
 */

export type DomainId =
  | "design"
  | "programming"
  | "processing"
  | "training"
  | "coordination"
  | "review";

export interface Domain {
  id: DomainId;
  /** As the guide titles it. */
  title: string;
  /** The guide's numbered task list for this domain. */
  tasks: string[];
  /** GCDMP chapters the guide marks applicable to this domain. */
  chapters: string[];
  /**
   * ICH GCP topics, where the guide lists any. Five of the six domains say in
   * so many words that there are none; only Training carries them.
   *
   * The topics are transcribed; the *guideline* each maps to is not. That
   * column of the guide's table is a multi-line cell beside another multi-line
   * cell, and extraction interleaves them irrecoverably — pairing them here
   * would be a guess presented as a fact. The topics alone are still the useful
   * half: they name what to go and read in E6.
   */
  ichTopics?: string[];
}

export const DOMAINS: Domain[] = [
  {
    id: "design",
    title: "Design",
    tasks: [
      "Assist with implementing data standards",
      "Assist in the design of the data collection forms",
      "Read and interpret annotated forms",
      "Assist in design of edit checks",
      "Understand data transfer specifications",
      "Create specifications for reports",
    ],
    chapters: [
      "Database Validation, Programming, and Standards",
      "Design and Development of Data Collection Instruments",
      "Edit Check Design Principles",
      "Electronic Data Capture--Concepts and Study Start-up",
      "Laboratory Data Handling",
      "Metrics for Clinical Trials",
    ],
  },
  {
    id: "programming",
    title: "Programming and Testing",
    tasks: [
      "Build data visualizations",
      "Test visualizations and reports",
      "Executes UAT of EDC/eCOA study-specific configuration",
      "Basic understanding of SQL and programming knowledge (R, Python, and Magro)",
      "Understand the types of programming tools that are available for data review, data reporting, and data analysis",
      "Runs simple import/export programs",
    ],
    chapters: [
      "Database Validation, Programming, and Standards",
      "Design and Development of Data Collection Instruments",
      "Edit Check Design Principles",
      "Electronic Data Capture--Concepts and Study Start-up",
      "Electronic Data Capture--Study Closeout",
      "Reports and Metrics",
    ],
  },
  {
    id: "processing",
    title: "Data Processing",
    tasks: [
      "Collect study data (Paper Process) including local lab ranges",
      "Enter data (Paper Process)",
      "Write simple queries",
    ],
    chapters: [
      "Data Entry Processes",
      "Data Privacy",
      "Design and Development of Data Collection Instruments",
      "Edit Check Design Principles",
      "Electronic Data Capture--Concepts and Study Start-up",
      "Laboratory Data Handling",
    ],
  },
  {
    id: "training",
    title: "Training",
    tasks: [
      "Support creation of investigator site training materials",
      "Demonstrate proficiency in Good Clinical Practice (GCP)",
      "Understand Drug Development process",
      "Understand and apply ALCOA+ principals",
      "Understand data privacy laws",
      "Understand randomization and study blinds",
      "Understand primary and secondary endpoints including critical variables",
      "Review and understand SOPs",
      "Review and understand Protocol",
      "Understanding the purpose of data standards",
      "Understanding the purpose of coding dictionaries",
      "Understand the data flow from initial entry through CSR",
      "Awareness of different roles to maintain the blind",
      "Understand TMF Reference Model and company-specific implementation",
      "Awareness of study documentation completeness in TMF Data Management zone",
    ],
    chapters: [
      "Design and Development of Data Collection Instruments",
      "Data Management Standards in Clinical Research",
      "Data Privacy",
      "Electronic Data Capture--Concepts and Study Start-up",
      "Laboratory Data Handling",
      "Medical Coding Dictionary Management & Maintenance",
      "Project Management for the Clinical Data Manager",
      "Vendor Selection and Management",
    ],
    ichTopics: [
      "Confidentiality of Records",
      "Data Governance - Investigator and Sponsor",
      "Data Management Standards in Clinical Research",
      "Data Privacy",
      "Essential Documents for the Conduct of a Clinical Trial",
      "Essential Records for the Conduct of a Clinical Trial",
      "Ethics Committee",
      "ICH GCP",
      "Investigator",
      "Investigator's Brochure",
      "Laboratory Data Handling",
      "Medical Coding Dictionary Management & Maintenance",
      "Principles of ICH GCP",
      "Sponsor",
      "Training",
    ],
  },
  {
    id: "coordination",
    title: "Coordination & Management",
    tasks: [
      "Assist with system and data management startup",
      "Assist and report on data collection and processing",
      "Assist with site data close-out",
      "Assist with tasks required for database lock",
      "Assist with implementation of new system",
      "Supporting summary of data trends",
      "Assists in creating study storyboards as part of inspection readiness",
      "Assists in document retrieval during inspections",
    ],
    chapters: [
      "Data Privacy",
      "Database Closure",
      "Database Validation, Programming, and Standards",
      "Design and Development of Data Collection Instruments",
      "Edit Check Design Principles",
      "Electronic Data Capture--Concepts and Study Start-up",
      "Electronic Data Capture--Study Closeout",
      "Laboratory Data Handling",
      "Medical Coding Dictionary Management & Maintenance",
      "Project Management for the Clinical Data Manager",
      "Reports and Metrics",
      "Serious Adverse Event Data Reconciliation",
    ],
  },
  {
    id: "review",
    title: "Review",
    tasks: [
      "Review protocols and study plans (e.g. data management plan, project management plan, safety management plan, site monitoring plan)",
      "Review reports for inconsistencies in the data",
      "Review work of peers",
      "Identify data driven protocol deviations",
      "Performs simple QC of study documentation content (e.g. version control)",
      "Understand the different data types",
    ],
    chapters: [
      "Data Entry Processes",
      "Data Privacy",
      "Database Closure",
      "Design and Development of Data Collection Instruments",
      "Edit Check Design Principles",
      "Electronic Data Capture--Concepts and Study Start-up",
      "Electronic Data Capture--Study Closeout",
      "Laboratory Data Handling",
      "Measuring Data Quality",
      "Project Management for the Clinical Data Manager",
      "Serious Adverse Event Data Reconciliation",
    ],
  },
];

/**
 * The chapters section 2 of the guide gives minimum standards and best
 * practices for.
 *
 * Worth marking separately from the domain lists. A chapter here is one the
 * guide has enumerated requirements for, which is where "which of the following
 * is a minimum standard" questions come from — so an unread chapter on this
 * list costs more than an unread chapter merely named against a domain.
 */
export const STANDARDS_CHAPTERS: string[] = [
  "Data Entry Processes",
  "Data Management Standards in Clinical Research",
  "Data Privacy",
  "Database Closure",
  "Database Validation, Programming, and Standards",
  "Design and Development of Data Collection Instruments",
  "Edit Check Design Principles",
  "Electronic Data Capture--Concepts and Study Start-up",
  "Electronic Data Capture--Study Closeout",
  "Laboratory Data Handling",
  "Measuring Data Quality",
  "Medical Coding Dictionary Management & Maintenance",
  "Project Management for the Clinical Data Manager",
  "Serious Adverse Event Data Reconciliation",
  "Vendor Selection and Management",
  "Vendor Selection and Management (Released 2021)",
];
