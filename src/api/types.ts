export interface Envelope<T> {
  status: string;
  data: T;
}

export interface LanguageListItem {
  id: number;
  name: string;
  code: string;
  icon: string;
  order: number;
  is_active: boolean;
}

export interface LanguageListData {
  languages: LanguageListItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface LanguageInfo {
  id: number;
  name: string;
  code: string;
}

export interface CategoryInfo {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
}

export interface TagInfo {
  id: number;
  name: string;
  slug: string;
}

export interface PostTranslationListItem {
  id: number;
  language: LanguageInfo;
  title: string;
  slug: string;
  /** Composed URL path (`blog/<slug>`); null when the brand has no blog container page. */
  full_path?: string | null;
  excerpt: string;
  revision_number: number;
  need_update: boolean;
  created_at: string;
  updated_at: string;
}

export interface PostTranslationDetail extends PostTranslationListItem {
  content: string;
  meta_title?: string | null;
  meta_description?: string | null;
  focus_keyword?: string | null;
  canonical_url?: string | null;
  robots_index: boolean;
  robots_follow: boolean;
}

export interface PostBase<T extends PostTranslationListItem> {
  id: number;
  creator_id: number;
  creator_name: string;
  author_id?: number | null;
  author_name?: string | null;
  reviewer_id?: number | null;
  reviewer_name?: string | null;
  status: string;
  published_at?: string | null;
  scheduled_at?: string | null;
  featured_image_id?: number | null;
  featured_image_url?: string | null;
  banner_image_id?: number | null;
  allow_comments: boolean;
  translations: T[];
  categories: CategoryInfo[];
  tags: TagInfo[];
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type PostListItem = PostBase<PostTranslationListItem>;

export interface RelatedPostInfo {
  id: number;
  title: string;
  slug: string;
  language_code: string;
}

export interface PostDetail extends PostBase<PostTranslationDetail> {
  slugs: Array<{ language_code: string; language_name: string; slug: string }>;
  related_posts: RelatedPostInfo[];
  seo_schema_id?: number | null;
}

export interface PostListData {
  posts: PostListItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface PostCategoryTranslation {
  id: number;
  language: LanguageInfo;
  name: string;
  slug: string;
  description?: string | null;
}

export interface PostCategoryListItem {
  id: number;
  translations: PostCategoryTranslation[];
  created_at: string;
  updated_at: string;
}

export interface PostCategoryListData {
  categories: PostCategoryListItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface TagTranslation {
  id: number;
  language: LanguageInfo;
  name: string;
  slug: string;
}

export interface TagListItem {
  id: number;
  translations: TagTranslation[];
  created_at: string;
  updated_at: string;
}

export interface TagListData {
  tags: TagListItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface SeoCheck {
  name: string;
  passed: boolean;
  info?: string | null;
}

export interface SeoAuditPerTranslation {
  translation_id: number;
  language: LanguageInfo;
  slug: string;
  focus_keyword?: string | null;
  word_count: number;
  checks: SeoCheck[];
}

export interface SeoAuditData {
  post_id: number;
  results: SeoAuditPerTranslation[];
}

export interface SlugTranslationItem {
  language_code: string;
  language_name: string;
  slug: string;
}

export interface SlugLookupData {
  type: "post" | "service" | "page";
  id: number;
  matched_language_code: string;
  /** Full routable path for the matched language — already container-wrapped. */
  matched_slug: string;
  translations: SlugTranslationItem[];
}

export interface PublicSearchItem {
  type: "post" | "service" | "page";
  id: number;
  title: string;
  slug: string;
  language_code: string;
  language_name: string;
  excerpt?: string | null;
  featured_image_url?: string | null;
}

export interface PublicSearchData {
  query: string;
  total: number;
  results: PublicSearchItem[];
}

// --- Services -------------------------------------------------------------
// Note: service translations have NO `content` field — a service's body lives
// in its attached cards, a separate model. So slug/meta live here; body links
// do not.

export interface ServiceTranslationListItem {
  id: number;
  language: LanguageInfo;
  title: string;
  slug: string;
  full_path?: string | null;
  excerpt?: string | null;
}

export interface ServiceTranslationDetail extends ServiceTranslationListItem {
  meta_title?: string | null;
  meta_description?: string | null;
  focus_keyword?: string | null;
  canonical_url?: string | null;
  robots_index: boolean;
  robots_follow: boolean;
}

export interface ServiceBase<T extends ServiceTranslationListItem> {
  id: number;
  status: string;
  published_at?: string | null;
  scheduled_at?: string | null;
  featured_image_id?: number | null;
  translations: T[];
  categories: CategoryInfo[];
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type ServiceListItem = ServiceBase<ServiceTranslationListItem>;
export type ServiceDetail = ServiceBase<ServiceTranslationDetail>;

export interface ServiceListData {
  services: ServiceListItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}
