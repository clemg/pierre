'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import {
  ButtonGroup,
  ButtonGroupItem,
} from '@pierre/docs-shared/components/ui/button-group';
import { DocsCodeExample } from '@pierre/docs-shared/docs/DocsCodeExample';
import type { DocsExampleTypes } from '@pierre/docs-shared/docs/types';
import { useState } from 'react';

interface CodeToggleProps {
  reactSingleFile: PreloadedFileResult<undefined>;
  reactPatchFile: PreloadedFileResult<undefined>;
  vanillaSingleFile: PreloadedFileResult<undefined>;
  vanillaPatchFile: PreloadedFileResult<undefined>;
}

export function CodeToggle({
  reactSingleFile,
  reactPatchFile,
  vanillaSingleFile,
  vanillaPatchFile,
}: CodeToggleProps) {
  const [type, setType] = useState<DocsExampleTypes>('vanilla');
  const [example, setExample] = useState<'single-file' | 'patch-file'>(
    'single-file'
  );

  const file = (() => {
    if (type === 'react') {
      if (example === 'single-file') {
        return reactSingleFile;
      } else {
        return reactPatchFile;
      }
    }
    if (example === 'single-file') {
      return vanillaSingleFile;
    } else {
      return vanillaPatchFile;
    }
  })();

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <ButtonGroup
          className="sm:flex-initial"
          value={type}
          onValueChange={(value) => setType(value as DocsExampleTypes)}
        >
          <ButtonGroupItem value="vanilla">Vanilla JS</ButtonGroupItem>
          <ButtonGroupItem value="react">React</ButtonGroupItem>
        </ButtonGroup>
        <ButtonGroup
          value={example}
          onValueChange={(value) =>
            setExample(value as 'single-file' | 'patch-file')
          }
        >
          <ButtonGroupItem value="single-file">Single file</ButtonGroupItem>
          <ButtonGroupItem value="patch-file">Patch file</ButtonGroupItem>
        </ButtonGroup>
      </div>
      <DocsCodeExample {...file} key={`${type}-${example}`} />
    </>
  );
}
