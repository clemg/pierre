// `next/font` only generates CSS variables when invoked from the consuming
// Next.js app's own files (the SWC plugin runs against this app's source, not
// transpiled workspace packages). Each app keeps its own font initializer and
// forwards `fontVariableClassName` into the shared `RootLayoutShell`.
import {
  Fira_Code,
  Geist,
  Geist_Mono,
  IBM_Plex_Mono,
  Inter,
  JetBrains_Mono,
} from 'next/font/google';
import localFont from 'next/font/local';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const berkeleyMono = localFont({
  src: './BerkeleyMonoVariable.woff2',
  variable: '--font-berkeley-mono',
});

const firaMono = Fira_Code({
  weight: ['400'],
  variable: '--font-fira-mono',
  subsets: ['latin'],
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400'],
  variable: '--font-ibm-plex-mono',
  subsets: ['latin'],
});

const jetbrainsMono = JetBrains_Mono({
  weight: ['400'],
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const fontVariableClassName = [
  berkeleyMono.variable,
  geistSans.variable,
  geistMono.variable,
  firaMono.variable,
  ibmPlexMono.variable,
  jetbrainsMono.variable,
  inter.variable,
].join(' ');
