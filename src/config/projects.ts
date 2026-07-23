export type ProjectId =
  | "estemoon"
  | "istanbul-care"
  | "albanian-hair-klinik"
  | "royal-hair"
  | "royal-hair-dominic"
  | "ic-dental-group"
  | "luneste-clinic"
  | "capelli-albanian"
  | "capelliport"
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
    frontendUrl: "https://main.d1m39bbqerebav.amplifyapp.com",
    defaultLanguage: "en",
  },
  "royal-hair-dominic": {
    id: "royal-hair-dominic",
    name: "Royal Hair Dominic",
    shortName: "RHD",
    apiBaseUrl: "https://api.rh-dominic.istanbul-care.com/v1",
    mediaBaseUrl: "https://api.rh-dominic.istanbul-care.com",
    frontendUrl: "https://main.d2dylfmvgck5cz.amplifyapp.com",
    defaultLanguage: "en",
  },
  "ic-dental-group": {
    id: "ic-dental-group",
    name: "IC Dental Group",
    shortName: "ICD",
    apiBaseUrl: "https://api.icd.istanbul-care.com/v1",
    mediaBaseUrl: "https://api.icd.istanbul-care.com",
    frontendUrl: "https://main.dor6dgk9xyo3d.amplifyapp.com",
    defaultLanguage: "en",
  },
  "luneste-clinic": {
    id: "luneste-clinic",
    name: "Luneste Clinic",
    shortName: "LC",
    apiBaseUrl: "https://api.lc.istanbul-care.com/v1",
    mediaBaseUrl: "https://api.lc.istanbul-care.com",
    frontendUrl: "https://main.d1qwnxq0gvbv65.amplifyapp.com",
    defaultLanguage: "en",
  },
  "capelli-albanian": {
    id: "capelli-albanian",
    name: "Capelli Albanian",
    shortName: "CA",
    apiBaseUrl: "https://api.ca.istanbul-care.com/v1",
    mediaBaseUrl: "https://api.ca.istanbul-care.com",
    frontendUrl: "https://main.d3uorp0agsozpd.amplifyapp.com",
    defaultLanguage: "en",
  },
  capelliport: {
    id: "capelliport",
    name: "Capelli Port",
    shortName: "CP",
    apiBaseUrl: "https://api.capelliport.istanbul-care.com/v1",
    mediaBaseUrl: "https://api.capelliport.istanbul-care.com",
    frontendUrl: "https://capelliport.it",
    defaultLanguage: "it",
  },
  "emperial-hair-clinic": {
    id: "emperial-hair-clinic",
    name: "Emperial Hair Clinic",
    shortName: "EHC",
    apiBaseUrl: "https://api.ehc.istanbul-care.com/v1",
    mediaBaseUrl: "https://api.ehc.istanbul-care.com",
    frontendUrl: "https://main.d1scnz4wu2fqmb.amplifyapp.com",
    defaultLanguage: "en",
  },
  staging: {
    id: "staging",
    name: "Staging",
    shortName: "Staging",
    apiBaseUrl: "https://staging.istanbul-care.com/v1",
    mediaBaseUrl: "https://staging.istanbul-care.com",
    frontendUrl: "https://staging.d3p75k79sxy2xd.amplifyapp.com",
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
