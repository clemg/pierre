import { buildDocsMetadata } from '@pierre/docs-shared/layout/buildDocsMetadata';
import { RootLayoutShell } from '@pierre/docs-shared/layout/RootLayoutShell';
import { docsViewport } from '@pierre/docs-shared/layout/viewport';
import '@pierre/docs-shared/styles/globals.css';
import { fontVariableClassName } from './fonts';

export const viewport = docsViewport;
// Icons are deliberately omitted: the file-convention assets in this segment
// (`icon.{ico,svg}`, `apple-icon.png`) take over.
export const metadata = buildDocsMetadata({ site: 'trees' });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RootLayoutShell site="trees" fontClassName={fontVariableClassName}>
      {children}
    </RootLayoutShell>
  );
}
