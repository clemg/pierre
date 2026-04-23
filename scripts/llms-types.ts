export type ProductId = 'diffs' | 'trees';

export interface LlmsSeeAlso {
  label: string;
  url: string;
  description: string;
}

export interface LlmsSiteConfig {
  /** Product identifier; used to pick a friendly name and package metadata. */
  productId: ProductId;
  /**
   * Path prefix (relative to the calling app's `app/` directory) where MDX
   * docs sit. e.g. `'docs'` for both docs-diffs and docs-trees after the
   * restructure.
   */
  docsPrefix: string;
  /** Public URL where the rendered docs live (used for in-llms.txt anchors). */
  docsUrl: string;
  /**
   * Output paths for the two artefacts, relative to the app root that calls
   * the script. e.g. `'public/llms.txt'`.
   */
  llmsTxtPath: string;
  llmsFullTxtPath: string;
  /**
   * Ordered list of sub-paths under `docsPrefix` that contain MDX content.
   * Each one becomes a section in the generated llms files.
   */
  sections: readonly string[];
  /** Map of section key → human-readable description for the index. */
  sectionDescriptions: Record<string, string>;
  /**
   * Optional override of the MDX filename for a given section. Keyed by
   * `${docsPrefix}/${section}` (matches the pattern used in the legacy script).
   */
  mdxFilenameOverrides?: Record<string, string>;
  /** Cross-reference links emitted in the See also section. */
  seeAlso: readonly LlmsSeeAlso[];
}
