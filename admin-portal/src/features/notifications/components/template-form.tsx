'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label } from '@medichain/ui';
import { createNotificationTemplatesApi } from '@medichain/api-client';
import type {
  NotificationTemplateChannel,
  NotificationTemplateSummary,
} from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';

const CHANNELS: readonly NotificationTemplateChannel[] = ['IN_APP', 'EMAIL', 'SMS', 'PUSH'];

/**
 * Create or edit a message template.
 *
 * Name and channel form the template's identity on the server, so they are fixed
 * once a template exists. Changing them here would silently create a second
 * template and leave the old one in use — the admin would see one disappear and
 * the message would keep its old wording.
 */
export function TemplateForm({
  template,
  onDone,
}: {
  template?: NotificationTemplateSummary;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const editing = template !== undefined;

  const [name, setName] = useState(template?.name ?? '');
  const [channel, setChannel] = useState<NotificationTemplateChannel>(template?.channel ?? 'EMAIL');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      callAuthed((client) =>
        createNotificationTemplatesApi(client).upsert({
          name: name.trim(),
          channel,
          subject: subject.trim() === '' ? undefined : subject.trim(),
          body,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
      onDone();
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : 'Could not save the template.'),
  });

  return (
    <form
      className="space-y-4 rounded-[var(--radius-card)] border border-slate-200 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (name.trim() === '' || body.trim() === '') {
          setError('Name and body are required.');
          return;
        }
        save.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="template-name">Name{editing ? ' (fixed after creation)' : ''}</Label>
          <Input
            id="template-name"
            placeholder="order.placed"
            value={name}
            disabled={editing}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="template-channel">Channel</Label>
          <select
            id="template-channel"
            className="h-10 w-full rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
            value={channel}
            disabled={editing}
            onChange={(e) => setChannel(e.target.value as NotificationTemplateChannel)}
          >
            {CHANNELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="template-subject">Subject (email only)</Label>
          <Input
            id="template-subject"
            placeholder="Order {{orderId}} placed"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="template-body">Body</Label>
          <textarea
            id="template-body"
            rows={5}
            className="block w-full rounded-[var(--radius-control)] bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-brand-700"
            placeholder="Hello {{name}}, your order is in."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
          <p className="text-xs text-slate-500">
            Use {'{{variable}}'} placeholders. They are substituted, never evaluated.
          </p>
        </div>
      </div>

      {error !== null && <p className="text-sm text-danger-600">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : editing ? 'Save template' : 'Create template'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
