export type ProjectId =
  | "estemoon"
  | "istanbul-care"
  | "albanian-hair-klinik"
  | "royal-hair"
  | "ic-dental-group"
  | "luneste-clinic"
  | "capelli-albanian"
  | "emperial-hair-clinic"
  | "staging";

export interface ProjectConfig {
  id: ProjectId;
  name: string;
  shortName: string;
  apiBaseUrl: string;
  mediaBaseUrl: string;
  frontendUrl: string;
  defaultLanguage: string;
}

export const PROJECTS: Record<ProjectId, ProjectConfig> = {
  estemoon: {
    id: "estemoon",
    name: "Estemoon",
    shortName: "ESM",
    apiBaseUrl: "https://api.estemoon.com/v1",
    mediaBaseUrl: "https://api.estemoon.com",
    frontendUrl: "https://estemoon.com",
    defaultLanguage: "en",
  },
  "istanbul-care": {
    id: "istanbul-care",
    name: "Istanbul Care",
    shortName: "IC",
    apiBaseUrl: "https://api.istanbul-care.com/v1",
    mediaBaseUrl: "https://api.istanbul-care.com",
    frontendUrl: "https://istanbul-care.com",
    defaultLanguage: "en",
  },
  "albanian-hair-klinik": {
    id: "albanian-hair-klinik",
    name: "Albania Hair Clinic",
    shortName: "AHC",
    apiBaseUrl: "https://api.albaniahairclinic.com/v1",
    mediaBaseUrl: "https://api.albaniahairclinic.com",
    frontendUrl: "https://albaniahairclinic.com",
    defaultLanguage: "en",
  },
  "royal-hair": {
    id: "royal-hair",
    name: "Royal Hair",
    shortName: "RH",
    apiBaseUrl: "https://api.rh.istanbul-care.com/v1",
    mediaBaseUrl: "https://api.rh.istanbul-care.com",
    frontendUrl: "https://royalhairistanbul.com",
    defaultLanguage: "en",
  },
  "ic-dental-group": {
    id: "ic-dental-group",
    name: "IC Dental Group",
    shortName: "ICD",
    apiBaseUrl: "https://api.icd.istanbul-care.com/v1",
    mediaBaseUrl: "https://api.icd.istanbul-care.com",
    frontendUrl: "https://istanbulcaredental.com",
    defaultLanguage: "en",
  },
  "luneste-clinic": {
    id: "luneste-clinic",
    name: "Luneste Clinic",
    shortName: "LC",
    apiBaseUrl: "https://api.lc.istanbul-care.com/v1",
    mediaBaseUrl: "https://api.lc.istanbul-care.com",
    frontendUrl: "https://lunesteclinic.com",
    defaultLanguage: "en",
  },
  // Not launched yet: no domain, and the tenant has no published pages. The
  // Amplify preview below no longer resolves either, so the public-URL tools
  // have nothing to point at. capellialbania.com is someone else's WordPress
  // site, not this brand's front end.
  "capelli-albanian": {
    id: "capelli-albanian",
    name: "Capelli Albanian",
    shortName: "CA",
    apiBaseUrl: "https://api.ca.istanbul-care.com/v1",
    mediaBaseUrl: "https://api.ca.istanbul-care.com",
    frontendUrl: "https://main.d3uorp0agsozpd.amplifyapp.com",
    defaultLanguage: "en",
  },
  // Not launched yet: no domain assigned.
  "emperial-hair-clinic": {
    id: "emperial-hair-clinic",
    name: "Emperial Hair Clinic",
    shortName: "EHC",
    apiBaseUrl: "https://api.ehc.istanbul-care.com/v1",
    mediaBaseUrl: "https://api.ehc.istanbul-care.com",
    frontendUrl: "https://main.d1scnz4wu2fqmb.amplifyapp.com",
    defaultLanguage: "en",
  },
  // The shared test environment. Its API is live; the Amplify preview that
  // used to serve its frontend is gone, so public-URL tools have nothing to
  // point at here and read_public_page will not work against it.
  staging: {
    id: "staging",
    name: "Staging",
    shortName: "Staging",
    apiBaseUrl: "https://staging.istanbul-care.com/v1",
    mediaBaseUrl: "https://staging.istanbul-care.com",
    frontendUrl: "https://staging.istanbul-care.com",
    defaultLanguage: "en",
  },
};

export const PROJECT_IDS = Object.keys(PROJECTS) as ProjectId[];

export function isProjectId(value: string): value is ProjectId {
  return Object.prototype.hasOwnProperty.call(PROJECTS, value);
}

function defaultLangEnvKey(id: ProjectId): string {
  return `ICMCP_DEFAULT_LANG_${id.toUpperCase().replace(/-/g, "_")}`;
}

export function getProject(id: string): ProjectConfig {
  if (!isProjectId(id)) {
    throw new Error(
      `Unknown project '${id}'. Known projects: ${PROJECT_IDS.join(", ")}`,
    );
  }
  const base = PROJECTS[id];
  const override = process.env[defaultLangEnvKey(id)];
  return override ? { ...base, defaultLanguage: override } : base;
}
