'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardHeader, CardTitle, CardDescription } from '@medichain/ui';
import { createNotificationTemplatesApi } from '@medichain/api-client';
import { Capability } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';
import { usePermission } from '@/features/auth/use-permission';
import { TemplateForm } from './template-form';

/**
 * Tenant notification templates.
 *
 * Wording here is what customers are told, so the screen is intentionally plain:
 * the body is text, placeholders are simple `{{name}}` substitutions, and every
 * change is written to the audit trail by the API.
 */
export function NotificationTemplatesScreen() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { can } = usePermission();
  const canWrite = can(Capability.SETTINGS_WRITE);
  const queryClient = useQueryClient();

  const templates = useQuery({
    queryKey: ['notification-templates'],
    queryFn: () => callAuthed((client) => createNotificationTemplatesApi(client).list()),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      callAuthed((client) => createNotificationTemplatesApi(client).remove(id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notification-templates'] }),
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : 'Could not delete the template.'),
  });

  if (templates.isPending) {
    return <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-200" />;
  }

  if (templates.isError || templates.data === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load notification templates</CardTitle>
          <CardDescription>Signing in again should fix it.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const rows = templates.data;
  const editing = rows.find((row) => row.id === editingId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Notification templates</h1>
          <p className="mt-1 text-sm text-slate-500">
            {rows.length} template{rows.length === 1 ? '' : 's'} for the channels this tenant sends
            on.
          </p>
        </div>
        {canWrite && !showCreate && editing === undefined && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            New template
          </Button>
        )}
      </div>

      {actionError !== null && <p className="text-sm text-danger-600">{actionError}</p>}

      {canWrite && showCreate && (
        <TemplateForm
          onDone={() => {
            setShowCreate(false);
          }}
        />
      )}

      {canWrite && editing !== undefined && (
        <TemplateForm
          template={editing}
          onDone={() => {
            setEditingId(null);
          }}
        />
      )}

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No templates yet</CardTitle>
            <CardDescription>
              Without a template, messages use the built-in wording in the application.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Templates</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full rounded border border-slate-200">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Name</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Channel</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Body</th>
                  <th className="p-3 text-left text-sm font-medium text-slate-600">Updated</th>
                  {canWrite && (
                    <th className="p-3 text-left text-sm font-medium text-slate-600">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((template) => (
                  <tr key={template.id} className="border-b border-slate-100">
                    <td className="p-3 text-sm font-medium text-slate-900">
                      {template.name}
                      {template.subject !== null && (
                        <span className="mt-0.5 block text-xs font-normal text-slate-500">
                          {template.subject}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-sm text-slate-500">{template.channel}</td>
                    <td className="max-w-md truncate p-3 text-sm text-slate-500">
                      {template.body}
                    </td>
                    <td className="p-3 text-sm text-slate-500">
                      {new Date(template.updatedAt).toLocaleDateString()}
                    </td>
                    {canWrite && (
                      <td className="p-3">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditingId(template.id);
                              setShowCreate(false);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (window.confirm(`Delete template “${template.name}”?`)) {
                                remove.mutate(template.id);
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
