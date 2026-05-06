'use client';

import { IconArrow, IconRefresh } from '@pierre/icons';
import { type ReactNode, type SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CodeViewUrlFormProps {
  className?: string;
  icon: ReactNode;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  submitting?: boolean;
  value: string;
}

// Panel card styles shared between the viewer header and the home page form
// wrapper so both surfaces stay visually in sync.
export const codeViewPanelClass =
  'border-border bg-background rounded-xl border p-3 shadow-xs';

// Shared URL input form used in the viewer header and the home page.
// Renders an icon slot, a ghost text input, and a submit button in a single row.
// The parent is responsible for controlled state and submission logic; this
// component calls onSubmit with the current value after preventing the default
// form event.
export function CodeViewUrlForm({
  className,
  icon,
  onChange,
  onSubmit,
  placeholder = 'e.g. https://github.com/twbs/bootstrap/pull/42139',
  submitting = false,
  value,
}: CodeViewUrlFormProps) {
  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(value);
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {icon}
      <span className="text-md hidden text-neutral-300 md:-mr-2 md:inline-flex">
        /
      </span>
      <form
        className="flex w-full flex-col gap-2 md:flex-row md:gap-2"
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onSubmit={handleSubmit}
      >
        <input
          className="text-md focus:bg-accent block h-8 w-full min-w-[220px] rounded-md px-2 text-center focus-visible:outline-none md:h-9 md:text-left"
          disabled={submitting}
          onChange={({ currentTarget }) => onChange(currentTarget.value)}
          placeholder={placeholder}
          value={value}
        />
        <Button
          type="submit"
          variant="default"
          size="icon"
          className="hidden md:flex"
          disabled={submitting}
          aria-label={submitting ? 'Fetching…' : 'Submit'}
        >
          {submitting ? (
            <IconRefresh className="size-4 animate-spin" />
          ) : (
            <IconArrow className="size-4 rotate-180" />
          )}
        </Button>
      </form>
    </div>
  );
}
