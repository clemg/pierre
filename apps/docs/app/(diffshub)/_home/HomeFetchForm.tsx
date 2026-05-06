'use client';

import { IconBrandGithub } from '@pierre/icons';
import { useRouter } from 'next/navigation';
import { memo, startTransition, useState, ViewTransition } from 'react';

import {
  codeViewPanelClass,
  CodeViewUrlForm,
} from '../(view)/_components/CodeViewUrlForm';
import { setCachedPatchText } from '../(view)/_components/patchCache';
import { getGitHubPath } from '../(view)/_components/utils';
import { cn } from '@/lib/utils';

const DEFAULT_PR_URL = 'https://github.com/nodejs/node/pull/59805';

// Submitting the home form pre-fetches the patch and caches it so the viewer
// can render immediately on arrival without a second round trip.
export const HomeFetchForm = memo(function HomeFetchForm() {
  const router = useRouter();
  const [url, setUrl] = useState(DEFAULT_PR_URL);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(rawUrl: string) {
    setErrorMessage(null);

    const prPath = getGitHubPath(rawUrl.trim());
    if (prPath == null) {
      setErrorMessage('Enter a valid GitHub pull request URL.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/fetch-pr-patch?path=${encodeURIComponent(prPath)}`
      );
      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new Error(
          detail.length > 0 ? detail : `Request failed (${response.status}).`
        );
      }
      const patchText = await response.text();
      setCachedPatchText(prPath, patchText);
      // `prPath` is shaped like `/owner/repo/pull/<number>` (or with a
      // trailing `.patch`), which is exactly the suffix the path-style
      // viewer route expects. Strip `.patch` because the route's dynamic
      // segment is just the PR number.
      const cleanPrPath = prPath.replace(/\.patch$/, '');
      startTransition(() => {
        router.push(cleanPrPath);
      });
    } catch (error) {
      setSubmitting(false);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to fetch the diff.'
      );
    }
  }

  return (
    <div className="my-5 space-y-2">
      <ViewTransition name="input">
        <CodeViewUrlForm
          className={cn(codeViewPanelClass)}
          icon={
            <div className="flex size-8 items-center justify-center">
              <IconBrandGithub className="text-muted-foreground size-6 shrink-0" />
            </div>
          }
          value={url}
          onChange={setUrl}
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onSubmit={handleSubmit}
          placeholder="Enter a GitHub pull request URL"
          submitting={submitting}
        />
      </ViewTransition>
      {errorMessage != null && (
        <p className="text-destructive text-sm" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
});
