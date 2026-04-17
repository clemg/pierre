import '@/app/prose.css';
import { preloadFile } from '@pierre/diffs/ssr';
import type { Metadata } from 'next';

import { DocsLayout } from '../../../docs/DocsLayout';
import { HeadingAnchors } from '../../../docs/HeadingAnchors';
import { ProseWrapper } from '../../../docs/ProseWrapper';
import {
  COMPOSITION_CONTEXT_MENU_EXAMPLE,
  COMPOSITION_HEADER_EXAMPLE,
} from '../../../trees/docs/Composition/constants';
import {
  PATH_STORE_FILE_TREE_OPTIONS_TYPE,
  PATH_STORE_ITEM_HANDLE_TYPE,
  PATH_STORE_SEARCH_MODE_TYPE,
  PATHS_OPTION_EXAMPLE,
} from '../../../trees/docs/CoreTypes/constants';
import {
  DND_CONFIG_EXAMPLE,
  DND_USAGE_EXAMPLE,
} from '../../../trees/docs/DragAndDrop/constants';
import {
  INSTALLATION_EXAMPLES,
  PACKAGE_MANAGERS,
} from '../../../trees/docs/Installation/constants';
import {
  MUTATIONS_BASIC_EXAMPLE,
  MUTATIONS_BATCH_EXAMPLE,
  MUTATIONS_EVENTS_EXAMPLE,
  MUTATIONS_RESET_EXAMPLE,
} from '../../../trees/docs/Mutations/constants';
import {
  OVERVIEW_FILE_TREE_OPTIONS,
  PATH_STORE_BASIC_USAGE,
  PATH_STORE_SSR_USAGE,
} from '../../../trees/docs/Overview/constants';
import {
  REACT_LEGACY_FILE_TREE,
  REACT_PATH_STORE_SSR,
  REACT_PATH_STORE_USAGE,
} from '../../../trees/docs/ReactAPI/constants';
import {
  RENAMING_CONFIG_EXAMPLE,
  RENAMING_USAGE_EXAMPLE,
} from '../../../trees/docs/Renaming/constants';
import {
  SSR_HYDRATION_EXAMPLE,
  SSR_PRELOAD_PATH_STORE_FILE_TREE,
} from '../../../trees/docs/SSR/constants';
import {
  STYLING_CODE_GLOBAL,
  STYLING_CODE_INLINE,
  STYLING_CODE_UNSAFE,
  STYLING_CODE_VANILLA,
} from '../../../trees/docs/Styling/constants';
import {
  THEMING_CODE_CUSTOM_THEME,
  THEMING_CODE_RESOLVE_THEME,
} from '../../../trees/docs/Theming/constants';
import {
  HELPER_GENERATE_LAZY_DATA_LOADER,
  HELPER_GENERATE_SYNC_DATA_LOADER,
  HELPER_SORT_CHILDREN,
} from '../../../trees/docs/Utilities/constants';
import {
  PATH_STORE_API_BASIC_EXAMPLE,
  PATH_STORE_API_FULL_EXAMPLE,
  VANILLA_API_CUSTOM_ICONS_EXAMPLE,
  VANILLA_API_GIT_STATUS_EXAMPLE,
  VANILLA_LEGACY_EXAMPLE,
} from '../../../trees/docs/VanillaAPI/constants';
import Footer from '@/components/Footer';
import { renderMDX } from '@/lib/mdx';

export const metadata: Metadata = {
  title: 'Pierre Trees Docs — API reference and guides.',
  description:
    'Documentation for @pierre/trees — installation, core types, React and vanilla APIs, utilities, styling, and SSR.',
};

export default function TreesDocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <DocsLayout>
        <div className="min-w-0 space-y-8">
          <HeadingAnchors />
          <OverviewSection />
          <InstallationSection />
          <CoreTypesSection />
          <ReactAPISection />
          <VanillaAPISection />
          <GitStatusSection />
          <CustomIconsSection />
          <MutationsSection />
          <DragAndDropSection />
          <CompositionSection />
          <RenamingSection />
          <UtilitiesSection />
          <StylingSection />
          <ThemingSection />
          <SSRSection />
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}

async function OverviewSection() {
  const [pathStoreBasicUsage, pathStoreSsrUsage] = await Promise.all([
    preloadFile(PATH_STORE_BASIC_USAGE),
    preloadFile(PATH_STORE_SSR_USAGE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/Overview/content.mdx',
    scope: {
      overviewFileTreeOptions: OVERVIEW_FILE_TREE_OPTIONS,
      pathStoreBasicUsage,
      pathStoreSsrUsage,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function InstallationSection() {
  const installationExamples = Object.fromEntries(
    await Promise.all(
      PACKAGE_MANAGERS.map(async (pm) => [
        pm,
        await preloadFile(INSTALLATION_EXAMPLES[pm]),
      ])
    )
  );
  const content = await renderMDX({
    filePath: 'trees/docs/Installation/content.mdx',
    scope: { installationExamples },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function CoreTypesSection() {
  const [
    pathStoreFileTreeOptionsType,
    pathStoreSearchModeType,
    pathStoreItemHandleType,
    pathsOptionExample,
  ] = await Promise.all([
    preloadFile(PATH_STORE_FILE_TREE_OPTIONS_TYPE),
    preloadFile(PATH_STORE_SEARCH_MODE_TYPE),
    preloadFile(PATH_STORE_ITEM_HANDLE_TYPE),
    preloadFile(PATHS_OPTION_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/CoreTypes/content.mdx',
    scope: {
      pathStoreFileTreeOptionsType,
      pathStoreSearchModeType,
      pathStoreItemHandleType,
      pathsOptionExample,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function ReactAPISection() {
  const [reactPathStoreUsage, reactPathStoreSsr, reactLegacyFileTree] =
    await Promise.all([
      preloadFile(REACT_PATH_STORE_USAGE),
      preloadFile(REACT_PATH_STORE_SSR),
      preloadFile(REACT_LEGACY_FILE_TREE),
    ]);
  const content = await renderMDX({
    filePath: 'trees/docs/ReactAPI/content.mdx',
    scope: {
      reactPathStoreUsage,
      reactPathStoreSsr,
      reactLegacyFileTree,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function VanillaAPISection() {
  const [
    pathStoreAPIBasicExample,
    pathStoreAPIFullExample,
    vanillaLegacyExample,
  ] = await Promise.all([
    preloadFile(PATH_STORE_API_BASIC_EXAMPLE),
    preloadFile(PATH_STORE_API_FULL_EXAMPLE),
    preloadFile(VANILLA_LEGACY_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/VanillaAPI/content.mdx',
    scope: {
      pathStoreAPIBasicExample,
      pathStoreAPIFullExample,
      vanillaLegacyExample,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function GitStatusSection() {
  const pathStoreGitStatus = await preloadFile(VANILLA_API_GIT_STATUS_EXAMPLE);
  const content = await renderMDX({
    filePath: 'trees/docs/GitStatus/content.mdx',
    scope: { pathStoreGitStatus },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function CustomIconsSection() {
  const pathStoreIcons = await preloadFile(VANILLA_API_CUSTOM_ICONS_EXAMPLE);
  const content = await renderMDX({
    filePath: 'trees/docs/Icons/content.mdx',
    scope: { pathStoreIcons },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function MutationsSection() {
  const [
    mutationsBasicExample,
    mutationsBatchExample,
    mutationsResetExample,
    mutationsEventsExample,
  ] = await Promise.all([
    preloadFile(MUTATIONS_BASIC_EXAMPLE),
    preloadFile(MUTATIONS_BATCH_EXAMPLE),
    preloadFile(MUTATIONS_RESET_EXAMPLE),
    preloadFile(MUTATIONS_EVENTS_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/Mutations/content.mdx',
    scope: {
      mutationsBasicExample,
      mutationsBatchExample,
      mutationsResetExample,
      mutationsEventsExample,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function DragAndDropSection() {
  const [dndConfigExample, dndUsageExample] = await Promise.all([
    preloadFile(DND_CONFIG_EXAMPLE),
    preloadFile(DND_USAGE_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/DragAndDrop/content.mdx',
    scope: { dndConfigExample, dndUsageExample },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function CompositionSection() {
  const [compositionHeaderExample, compositionContextMenuExample] =
    await Promise.all([
      preloadFile(COMPOSITION_HEADER_EXAMPLE),
      preloadFile(COMPOSITION_CONTEXT_MENU_EXAMPLE),
    ]);
  const content = await renderMDX({
    filePath: 'trees/docs/Composition/content.mdx',
    scope: { compositionHeaderExample, compositionContextMenuExample },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function RenamingSection() {
  const [renamingConfigExample, renamingUsageExample] = await Promise.all([
    preloadFile(RENAMING_CONFIG_EXAMPLE),
    preloadFile(RENAMING_USAGE_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/Renaming/content.mdx',
    scope: { renamingConfigExample, renamingUsageExample },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function UtilitiesSection() {
  const [sortChildren, generateSyncDataLoader, generateLazyDataLoader] =
    await Promise.all([
      preloadFile(HELPER_SORT_CHILDREN),
      preloadFile(HELPER_GENERATE_SYNC_DATA_LOADER),
      preloadFile(HELPER_GENERATE_LAZY_DATA_LOADER),
    ]);
  const content = await renderMDX({
    filePath: 'trees/docs/Utilities/content.mdx',
    scope: {
      sortChildren,
      generateSyncDataLoader,
      generateLazyDataLoader,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function SSRSection() {
  const [preloadPathStoreFileTree, ssrHydrationExample] = await Promise.all([
    preloadFile(SSR_PRELOAD_PATH_STORE_FILE_TREE),
    preloadFile(SSR_HYDRATION_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/SSR/content.mdx',
    scope: { preloadPathStoreFileTree, ssrHydrationExample },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function StylingSection() {
  const [stylingGlobal, stylingInline, stylingVanilla, stylingUnsafe] =
    await Promise.all([
      preloadFile(STYLING_CODE_GLOBAL),
      preloadFile(STYLING_CODE_INLINE),
      preloadFile(STYLING_CODE_VANILLA),
      preloadFile(STYLING_CODE_UNSAFE),
    ]);
  const content = await renderMDX({
    filePath: 'trees/docs/Styling/content.mdx',
    scope: {
      stylingGlobal,
      stylingInline,
      stylingUnsafe,
      stylingVanilla,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function ThemingSection() {
  const [themingResolveTheme, themingCustomTheme] = await Promise.all([
    preloadFile(THEMING_CODE_RESOLVE_THEME),
    preloadFile(THEMING_CODE_CUSTOM_THEME),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/Theming/content.mdx',
    scope: {
      themingResolveTheme,
      themingCustomTheme,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}
