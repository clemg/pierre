import { buildDocsMetadata } from '@pierre/docs-shared/layout/buildDocsMetadata';
import { RootLayoutShell } from '@pierre/docs-shared/layout/RootLayoutShell';
import { docsViewport } from '@pierre/docs-shared/layout/viewport';
import '@pierre/docs-shared/styles/globals.css';
import { PreloadHighlighter } from '../features/diffs/PreloadHighlighter';
import { fontVariableClassName } from './fonts';

export const viewport = docsViewport;
export const metadata = buildDocsMetadata({
  site: 'diffs',
  includeFaviconIcons: true,
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RootLayoutShell site="diffs" fontClassName={fontVariableClassName}>
      {children}
      <PreloadHighlighter />
    </RootLayoutShell>
  );
}
