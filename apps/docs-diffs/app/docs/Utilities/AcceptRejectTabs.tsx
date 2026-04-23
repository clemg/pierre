'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import {
  ButtonGroup,
  ButtonGroupItem,
} from '@pierre/docs-shared/components/ui/button-group';
import { DocsCodeExample } from '@pierre/docs-shared/docs/DocsCodeExample';
import { useState } from 'react';

interface AcceptRejectTabsProps {
  diffAcceptReject: PreloadedFileResult<undefined>;
  diffAcceptRejectReact: PreloadedFileResult<undefined>;
}

export function AcceptRejectTabs({
  diffAcceptReject,
  diffAcceptRejectReact,
}: AcceptRejectTabsProps) {
  const [acceptRejectType, setAcceptRejectType] = useState<'vanilla' | 'react'>(
    'vanilla'
  );

  return (
    <>
      <ButtonGroup
        value={acceptRejectType}
        onValueChange={(value) =>
          setAcceptRejectType(value as 'vanilla' | 'react')
        }
      >
        <ButtonGroupItem value="vanilla">Basic Usage</ButtonGroupItem>
        <ButtonGroupItem value="react">React Example</ButtonGroupItem>
      </ButtonGroup>
      {acceptRejectType === 'vanilla' ? (
        <DocsCodeExample {...diffAcceptReject} key={acceptRejectType} />
      ) : (
        <DocsCodeExample {...diffAcceptRejectReact} key={acceptRejectType} />
      )}
    </>
  );
}
