'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import {
  ButtonGroup,
  ButtonGroupItem,
} from '@pierre/docs-shared/components/ui/button-group';
import { DocsCodeExample } from '@pierre/docs-shared/docs/DocsCodeExample';
import { useState } from 'react';

import { PACKAGE_MANAGERS, type PackageManager } from './constants';

interface PackageManagerTabsProps {
  installationExamples: Record<PackageManager, PreloadedFileResult<undefined>>;
}

export function PackageManagerTabs({
  installationExamples,
}: PackageManagerTabsProps) {
  const [selectedPm, setSelectedPm] = useState<PackageManager>('npm');

  return (
    <>
      <ButtonGroup
        value={selectedPm}
        onValueChange={(v) => setSelectedPm(v as PackageManager)}
      >
        {PACKAGE_MANAGERS.map((pm) => (
          <ButtonGroupItem key={pm} value={pm}>
            {pm}
          </ButtonGroupItem>
        ))}
      </ButtonGroup>
      <DocsCodeExample {...installationExamples[selectedPm]} key={selectedPm} />
    </>
  );
}
